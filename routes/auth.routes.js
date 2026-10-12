const express = require('express');
const router = express.Router();
const { createUser, login, forgotPassword, validateResetToken, resetPassword, changePassword } = require('../controllers/auth.controller');
const { isAuthenticated, authorizeRoles } = require('../middleware/auth.middleware');

router.post('/create-user', createUser);
router.post('/login', login);

// Password Reset Routes
router.post('/forget-password', forgotPassword);
router.get('/reset-password/:token', validateResetToken);
router.post('/reset-password/:token', resetPassword);

// Authenticated Password Change
router.post('/change-password', isAuthenticated, changePassword);

// Example protected route:
router.get('/admin-data', isAuthenticated, authorizeRoles('admin', 'superAdmin'), (req, res) => {
  res.json({ message: 'Admin Data Accessed' });
});

module.exports = router;      
