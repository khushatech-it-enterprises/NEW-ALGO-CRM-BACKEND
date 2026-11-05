const cron = require('node-cron');
const mongoose = require('mongoose');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

let isSyncRunning = false;
let lastSyncStatus = {
  status: 'idle',
  lastRun: null,
  lastSummary: null,
};

/**
 * Fast deterministic MD5 hash for comparing two BSON/JSON documents.
 * Returns identical hash for documents with identical key/value content.
 */
function computeDocChecksum(doc) {
  if (!doc) return '';
  try {
    const serialized = JSON.stringify(doc);
    return crypto.createHash('md5').update(serialized).digest('hex');
  } catch (err) {
    return '';
  }
}

/**
 * Syncs all data from source database (MONGODB_URI) to target backup database (CronJobsDBSTring).
 * - Scans all dynamic collections from MongoDB plus all defined CRM models.
 * - Uploads new documents (inserts).
 * - Replaces modified documents (updates).
 * - Leaves untouched documents alone (no-op).
 * - Preserves all ObjectIds, nested relations, arrays, dates, and data types intact.
 * - Replicates collection indexes.
 */
async function runDatabaseBackupSync() {
  if (isSyncRunning) {
    console.warn('⚠️ [DatabaseBackupCron] Sync is already running. Skipping overlapping execution.');
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

  // Source URI: allows explicit LIVE_SOURCE_DB_URI override so local test data is never used
  const sourceUri = process.env.LIVE_SOURCE_DB_URI || process.env.MONGODB_URI;
  const targetUri = process.env.CronJobsDBSTring;

  if (!sourceUri) {
    console.error('❌ [DatabaseBackupCron] Source database URI is not set in environment.');
    return { success: false, reason: 'MISSING_SOURCE_URI' };
  }

  if (!targetUri) {
    console.warn('⚠️ [DatabaseBackupCron] CronJobsDBSTring is not set in .env. Backup skipped.');
    return { success: false, reason: 'MISSING_TARGET_URI' };
  }

  isSyncRunning = true;
  const startTime = Date.now();
  console.log(`\n================================================================`);
  console.log(`🚀 [DatabaseBackupCron] Backup Data Sync Started: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`================================================================`);

  let sourceConn = null;
  let targetConn = null;
  let ownSourceConn = false;

  const summary = {
    startTime: new Date().toISOString(),
    totalCollections: 0,
    collectionsProcessed: 0,
    totalSourceDocs: 0,
    totalInserted: 0,
    totalUpdated: 0,
    totalUnchanged: 0,
    failedCollections: [],
  };

  try {
    // 1. Establish Source Connection
    if (sourceUri === process.env.MONGODB_URI && mongoose.connection && mongoose.connection.readyState === 1) {
      sourceConn = mongoose.connection;
      console.log('🔗 [DatabaseBackupCron] Reusing active Mongoose connection to: ' + sourceConn.name);
    } else {
      console.log('🔗 [DatabaseBackupCron] Opening dedicated connection to live source database...');
      sourceConn = await mongoose.createConnection(sourceUri, {
        serverSelectionTimeoutMS: 30000,
      }).asPromise();
      ownSourceConn = true;
      console.log('✅ [DatabaseBackupCron] Connected to live source database: ' + sourceConn.name);
    }

    // 2. Establish Target Connection (CronJobsDBSTring)
    console.log('🔗 [DatabaseBackupCron] Connecting to target backup database (CronJobsDBSTring)...');
    targetConn = await mongoose.createConnection(targetUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000,
    }).asPromise();
    console.log(`✅ [DatabaseBackupCron] Connected to target database: "${targetConn.name}"`);

    const sourceDb = sourceConn.db;
    const targetDb = targetConn.db;

    // 3. Discover all collections
    const rawCollections = await sourceDb.listCollections().toArray();
    const collectionNames = new Set(
      rawCollections
        .map(c => c.name)
        .filter(name => !name.startsWith('system.') && name !== '')
    );

    // Also include any registered Mongoose model collection names
    const registeredModelNames = mongoose.modelNames();
    for (const mName of registeredModelNames) {
      try {
        const collName = mongoose.model(mName).collection.name;
        if (collName && !collName.startsWith('system.')) {
          collectionNames.add(collName);
        }
      } catch (e) {
        // Ignore lookup error
      }
    }

    const sortedCollections = Array.from(collectionNames).sort();
    summary.totalCollections = sortedCollections.length;
    console.log(`📋 [DatabaseBackupCron] Found ${sortedCollections.length} collections to synchronize.`);

    const BATCH_SIZE = 500;

    // 4. Synchronize collection by collection
    for (const colName of sortedCollections) {
      const colStartTime = Date.now();
      const sourceColl = sourceDb.collection(colName);
      const targetColl = targetDb.collection(colName);

      let colTotal = 0;
      let colInserted = 0;
      let colUpdated = 0;
      let colUnchanged = 0;

      try {
        colTotal = await sourceColl.countDocuments();
        summary.totalSourceDocs += colTotal;

        if (colTotal === 0) {
          console.log(`   ▫️ Collection: [${colName}] -> 0 documents (empty)`);
          summary.collectionsProcessed++;
          continue;
        }

        // Replicate indexes from source to target
        try {
          const indexes = await sourceColl.indexes();
          for (const idx of indexes) {
            if (idx.name === '_id_') continue;
            const { key, name, unique, sparse, expireAfterSeconds } = idx;
            const indexOptions = { name };
            if (unique) indexOptions.unique = true;
            if (sparse) indexOptions.sparse = true;
            if (expireAfterSeconds !== undefined) indexOptions.expireAfterSeconds = expireAfterSeconds;

            await targetColl.createIndex(key, indexOptions).catch(err => {
              // Non-fatal if index exists or slight conflict
            });
          }
        } catch (idxErr) {
          console.warn(`   ⚠️ [${colName}] Index replication warning: ${idxErr.message}`);
        }

        // Stream and process in batches
        const cursor = sourceColl.find({}).batchSize(BATCH_SIZE);
        let batch = [];

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          batch.push(doc);

          if (batch.length >= BATCH_SIZE) {
            const stats = await syncBatch(batch, targetColl);
            colInserted += stats.inserted;
            colUpdated += stats.updated;
            colUnchanged += stats.unchanged;
            batch = [];
          }
        }

        // Process final remaining batch
        if (batch.length > 0) {
          const stats = await syncBatch(batch, targetColl);
          colInserted += stats.inserted;
          colUpdated += stats.updated;
          colUnchanged += stats.unchanged;
          batch = [];
        }

        summary.totalInserted += colInserted;
        summary.totalUpdated += colUpdated;
        summary.totalUnchanged += colUnchanged;
        summary.collectionsProcessed++;

        const elapsedMs = Date.now() - colStartTime;
        console.log(
          `   ✔️ Collection: [${colName}] | Total: ${colTotal} | Inserted: ${colInserted} | Updated: ${colUpdated} | Unchanged: ${colUnchanged} (${(elapsedMs / 1000).toFixed(2)}s)`
        );
      } catch (colErr) {
        console.error(`   ❌ [${colName}] Failed to sync:`, colErr.message);
        summary.failedCollections.push({ collection: colName, error: colErr.message });
      }
    }

    const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
    summary.durationSeconds = totalSeconds;
    summary.endTime = new Date().toISOString();

    lastSyncStatus = {
      status: 'success',
      lastRun: new Date().toISOString(),
      durationSeconds: totalSeconds,
      summary,
    };

    console.log(`\n================================================================`);
    console.log(`🏁 [DatabaseBackupCron] Backup Data Sync Completed in ${totalSeconds}s`);
    console.log(`   - Collections processed: ${summary.collectionsProcessed} / ${summary.totalCollections}`);
    console.log(`   - Total source records : ${summary.totalSourceDocs}`);
    console.log(`   - New records inserted : ${summary.totalInserted}`);
    console.log(`   - Records updated      : ${summary.totalUpdated}`);
    console.log(`   - Records unchanged    : ${summary.totalUnchanged}`);
    if (summary.failedCollections.length > 0) {
      console.log(`   - Failed collections   : ${summary.failedCollections.map(f => f.collection).join(', ')}`);
    }
    console.log(`================================================================\n`);

    return { success: true, summary };
  } catch (err) {
    console.error('❌ [DatabaseBackupCron] Fatal error in database backup sync:', err);
    return { success: false, error: err.message };
  } finally {
    isSyncRunning = false;
    if (targetConn) {
      try {
        await targetConn.close();
      } catch (e) {
        // ignore close error
      }
    }
    if (ownSourceConn && sourceConn) {
      try {
        await sourceConn.close();
      } catch (e) {
        // ignore close error
      }
    }
  }
}

/**
 * Compares batch of source documents against target collection.
 * Only writes documents that are NEW or MODIFIED.
 * Leaves UNCHANGED documents untouched.
 */
async function syncBatch(sourceBatch, targetColl) {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  const ids = sourceBatch.map(d => d._id);
  const targetDocs = await targetColl.find({ _id: { $in: ids } }).toArray();

  const targetMap = new Map();
  for (const tDoc of targetDocs) {
    targetMap.set(tDoc._id.toString(), tDoc);
  }

  const bulkOps = [];

  for (const sDoc of sourceBatch) {
    const sIdStr = sDoc._id.toString();
    const tDoc = targetMap.get(sIdStr);

    if (!tDoc) {
      // Document does not exist in target DB -> NEW DATA
      bulkOps.push({
        replaceOne: {
          filter: { _id: sDoc._id },
          replacement: sDoc,
          upsert: true,
        },
      });
      inserted++;
    } else {
      // Document exists -> compare checksums
      const sHash = computeDocChecksum(sDoc);
      const tHash = computeDocChecksum(tDoc);

      if (sHash === tHash) {
        // Identical content -> DO NOTHING
        unchanged++;
      } else {
        // Document has modified fields -> REPLACE WITH NEW ONE
        bulkOps.push({
          replaceOne: {
            filter: { _id: sDoc._id },
            replacement: sDoc,
            upsert: true,
          },
        });
        updated++;
      }
    }
  }

  if (bulkOps.length > 0) {
    await targetColl.bulkWrite(bulkOps, { ordered: false });
  }

  return { inserted, updated, unchanged };
}

/**
 * Schedule the Cron Job to run every day at 3:00 PM (15:00) IST
 * Cron syntax: '0 15 * * *'
 * Timezone: 'Asia/Kolkata'
 *
 * SAFETY LOCK:
 * - Only runs automatically when NODE_ENV === 'production' OR ENABLE_DATABASE_BACKUP_CRON === 'true'.
 * - When running on local/dev machines, automatic 3 PM cron is DISABLED to protect
 *   live backup database from being overwritten with local test data.
 */
const isProduction = process.env.NODE_ENV === 'production';
const isExplicitlyEnabled = process.env.ENABLE_DATABASE_BACKUP_CRON === 'true';

let backupJob = null;

if (isProduction || isExplicitlyEnabled) {
  backupJob = cron.schedule(
    '0 15 * * *',
    async () => {
      console.log('⏰ [DatabaseBackupCron] Scheduled trigger fired at 15:00 (3 PM) IST on LIVE server.');
      try {
        await runDatabaseBackupSync();
      } catch (err) {
        console.error('❌ [DatabaseBackupCron] Scheduled backup execution error:', err);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    }
  );
  console.log('📅 [DatabaseBackupCron] Cron Job registered: Scheduled to run every day at 3:00 PM IST (Asia/Kolkata) on LIVE server.');
} else {
  console.log('🛡️ [DatabaseBackupCron] LOCAL SAFETY LOCK ACTIVE:');
  console.log('   Automatic 3:00 PM backup cron is DISABLED locally so your local test data will NEVER be pushed to backup.');
  console.log('   Live data backup only runs on your production server (where NODE_ENV=production or ENABLE_DATABASE_BACKUP_CRON=true).');
}

// Support manual CLI invocation: node Crone-Job/DatabaseBackupCron.js --manual
if (require.main === module || process.argv.includes('--manual')) {
  console.log('⚡ [DatabaseBackupCron] Manual trigger detected from CLI.');
  runDatabaseBackupSync().then(result => {
    console.log('Manual sync result:', result.success ? 'SUCCESS' : 'FAILED');
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = {
  backupJob,
  runDatabaseBackupSync,
  getLastSyncStatus: () => lastSyncStatus,
};
