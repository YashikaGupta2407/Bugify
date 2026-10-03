// backend/src/routes/extensionRoutes.js
const express = require('express');
const router = express.Router();
const {
  analyzeDiagnostic,
  getExtensionSessions,
  getExtensionStats,
} = require('../controllers/extensionController');

// Route-level JSON body limit of 100 KB
const jsonParser = express.json({ limit: '100kb' });

// POST /api/extension/analyze - Analyze VS Code diagnostic or code snippet
router.post('/analyze', jsonParser, analyzeDiagnostic);

// GET /api/extension/sessions - List recent extension debug sessions
router.get('/sessions', getExtensionSessions);

// GET /api/extension/stats - Diagnostic error counts grouped by errorType
router.get('/stats', getExtensionStats);

module.exports = router;
