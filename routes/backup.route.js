const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backup.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

// Trigger backup on demand (Admin / SuperAdmin only)
router.post('/trigger', isAuthenticated, authorizeRoles('superAdmin', 'admin'), backupController.triggerBackup);

// Get backup status & schedule information
router.get('/status', isAuthenticated, authorizeRoles('superAdmin', 'admin'), backupController.getBackupStatus);

module.exports = router;
