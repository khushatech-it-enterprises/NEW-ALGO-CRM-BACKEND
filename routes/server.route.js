const express = require('express');
const router = express.Router();

const serverController = require('../controllers/server.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

// Used for table data show with search and pagination
router.get('/get-all-servers-for-tableShow', isAuthenticated, serverController.getAllServersForTableShow);

// Used for dropdown options and dynamic form configuration
router.get('/get-all-servers', isAuthenticated, serverController.getAllServers);

// CRUD routes
router.post('/create-server', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store'), serverController.createServer);
router.patch('/update-server/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store'), serverController.updateServer);
router.delete('/delete/:id', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store'), serverController.deleteServer);

// Explicit seed route
router.post('/seed-default-servers', isAuthenticated, authorizeRoles('superAdmin', 'admin', 'store'), serverController.seedDefaultServers);

module.exports = router;
