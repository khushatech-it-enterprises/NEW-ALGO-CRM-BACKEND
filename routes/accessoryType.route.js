const express = require('express');
const router = express.Router();

const accessoryTypeController = require('../controllers/accessoryType.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

// Used for table data show with search and pagination
router.get('/get-all-accessory-types-for-tableShow', isAuthenticated, accessoryTypeController.getAllAccessoryTypesForTableShow);

// Export route
router.get('/export-accessory-types', isAuthenticated, accessoryTypeController.exportAccessoryTypes);

// Used for dropdown / multi-select options in forms
router.get('/get-all-accessory-types', isAuthenticated, accessoryTypeController.getAllAccessoryTypes);

// CRUD routes
router.post('/create-accessory-type', isAuthenticated, authorizeRoles('superAdmin', 'admin'), accessoryTypeController.createAccessoryType);
router.patch('/update-accessory-type/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin'), accessoryTypeController.updateAccessoryType);
router.delete('/delete/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin'), accessoryTypeController.deleteAccessoryType);

// Seed default route
router.post('/seed-default-accessory-types', isAuthenticated, authorizeRoles('superAdmin', 'admin'), accessoryTypeController.seedDefaultAccessoryTypes);

module.exports = router;
