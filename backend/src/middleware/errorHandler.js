// backend/src/middleware/errorHandler.js
// Global error handling middleware returning standardized JSON responses.

function errorHandler(err, req, res, next) {
  console.error('Unhandled error occurred:', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: message,
    status: 'error',
  });
}

module.exports = errorHandler;
