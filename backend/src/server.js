// backend/src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const submissionRoutes = require('./routes/submissionRoutes');
const extensionRoutes = require('./routes/extensionRoutes');
const errorHandler = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFoundHandler');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '127.0.0.1';

// Middleware
app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Bugify backend is running',
  });
});

// API Routes
app.use('/api/submissions', submissionRoutes);
app.use('/api/extension', extensionRoutes);

// 404 Handler for undefined routes
app.use(notFoundHandler);

// Central Error Handler
app.use(errorHandler);

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, HOST, () => {
    console.log(`Bugify backend server running on http://${HOST}:${PORT}`);
  });
}

module.exports = app;
