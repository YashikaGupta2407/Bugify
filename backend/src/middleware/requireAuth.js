const { readSessionCookie, verifySessionToken } = require('../services/authService');

function requireAuth(req, res, next) {
  const token = readSessionCookie(req.headers.cookie);
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
  }

  req.user = { id: session.userId };
  return next();
}

module.exports = requireAuth;
