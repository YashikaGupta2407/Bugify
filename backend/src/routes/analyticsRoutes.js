const express = require('express');
const { getErrorAnalytics } = require('../controllers/analyticsController');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.get('/errors', requireAuth, getErrorAnalytics);

module.exports = router;
