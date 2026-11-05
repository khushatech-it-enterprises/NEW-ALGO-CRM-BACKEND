const { runDatabaseBackupSync, getLastSyncStatus } = require('../Crone-Job/DatabaseBackupCron');

/**
 * Triggers a manual database backup sync on demand.
 */
const triggerBackup = async (req, res) => {
  try {
    console.log(`[BackupController] Manual backup requested by ${req.user ? req.user.email || req.user.name : 'Authorized Admin'}`);
    const result = await runDatabaseBackupSync();
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Live database backup sync completed successfully.',
        data: result.summary,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: `Backup failed or skipped: ${result.reason || result.error}`,
        data: result,
      });
    }
  } catch (error) {
    console.error('[BackupController] Error triggering backup:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while executing backup sync.',
      error: error.message,
    });
  }
};

/**
 * Returns current backup status and last run metadata.
 */
const getBackupStatus = async (req, res) => {
  try {
    const status = getLastSyncStatus();
    return res.status(200).json({
      success: true,
      schedule: '0 15 * * * (Every day at 3:00 PM IST / Asia/Kolkata)',
      targetDatabaseEnvKey: 'CronJobsDBSTring',
      status,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve backup status.',
      error: error.message,
    });
  }
};

module.exports = {
  triggerBackup,
  getBackupStatus,
};
