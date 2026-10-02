// backend/src/middleware/notFoundHandler.js
// 404 Not Found handler returning JSON.

function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: `Cannot ${req.method} ${req.originalUrl}`,
    status: 'not_found',
  });
}

module.exports = notFoundHandler;
