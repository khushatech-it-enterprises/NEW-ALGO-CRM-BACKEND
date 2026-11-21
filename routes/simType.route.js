const express = require('express');
const router = express.Router();

const simTypeController = require('../controllers/simType.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

// Used for table data show with search and pagination
router.get('/get-all-sim-types-for-tableShow', isAuthenticated, simTypeController.getAllSimTypesForTableShow);

// Export route
router.get('/export-sim-types', isAuthenticated, simTypeController.exportSimTypes);

// Used for dropdown / multi-select options in forms
router.get('/get-all-sim-types', isAuthenticated, simTypeController.getAllSimTypes);

// CRUD routes
router.post('/create-sim-type', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store', 'r&d'), simTypeController.createSimType);
router.patch('/update-sim-type/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store', 'r&d'), simTypeController.updateSimType);
router.delete('/delete/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store', 'r&d'), simTypeController.deleteSimType);

// Seed default route
router.post('/seed-default-sim-types', isAuthenticated, authorizeRoles('superAdmin', 'admin'), simTypeController.seedDefaultSimTypes);

module.exports = router;
