// backend/src/routes/submissionRoutes.js
const express = require('express');
const router = express.Router();
const {
  createSubmission,
  getSubmissions,
  getSubmissionById,
} = require('../controllers/submissionController');

// POST /api/submissions - Submit code for execution, error classification, and AI explanation
router.post('/', createSubmission);

// GET /api/submissions - Retrieve debugging history list
router.get('/', getSubmissions);

// GET /api/submissions/:id - Retrieve complete debugging attempt with result & AI explanation
router.get('/:id', getSubmissionById);

module.exports = router;
