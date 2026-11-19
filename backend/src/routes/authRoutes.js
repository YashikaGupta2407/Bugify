const express = require('express');
const { register, login, currentUser, logout } = require('../controllers/authController');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, currentUser);
router.post('/logout', requireAuth, logout);

module.exports = router;
