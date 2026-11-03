const express = require('express');
const router = express.Router();

const assetTypeController = require('../controllers/assetType.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

// Used for table data show with search and pagination
router.get('/get-all-asset-types-for-tableShow', isAuthenticated, assetTypeController.getAllAssetTypesForTableShow);

// Used for dropdown / multi-select options in forms
router.get('/get-all-asset-types', isAuthenticated, assetTypeController.getAllAssetTypes);

// CRUD routes
router.post('/create-asset-type', isAuthenticated, authorizeRoles('superAdmin', 'admin'), assetTypeController.createAssetType);
router.patch('/update-asset-type/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin'), assetTypeController.updateAssetType);
router.delete('/delete/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin'), assetTypeController.deleteAssetType);

// Seed default route
router.post('/seed-default-asset-types', isAuthenticated, authorizeRoles('superAdmin', 'admin'), assetTypeController.seedDefaultAssetTypes);

module.exports = router;
