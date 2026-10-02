// backend/src/routes/submissionRoutes.js
const express = require('express');
const router = express.Router();
const { createSubmission } = require('../controllers/submissionController');

// POST /api/submissions - Submit code for execution and analysis
router.post('/', createSubmission);

module.exports = router;
