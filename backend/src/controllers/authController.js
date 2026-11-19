const {
  SESSION_COOKIE,
  SESSION_SECONDS,
  REMEMBERED_SESSION_SECONDS,
  hashPassword,
  verifyPassword,
  createSessionToken,
  sessionCookieOptions,
} = require('../services/authService');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNKNOWN_USER_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

function sendSession(res, user, remember = false) {
  const maxAge = remember ? REMEMBERED_SESSION_SECONDS : SESSION_SECONDS;
  const token = createSessionToken(user.id, maxAge);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(remember ? maxAge : undefined));
  return res.status(200).json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email },
  });
}

function createAuthHandlers(database) {
  async function register(req, res, next) {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';

      if (name.length < 1 || name.length > 80) {
        return res.status(400).json({ success: false, message: 'Enter your name (up to 80 characters).' });
      }
      if (!emailPattern.test(email) || email.length > 254) {
        return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
      }
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ success: false, message: 'Password must be between 8 and 128 characters.' });
      }

      const user = await database.user.create({
        data: { name, email, password: await hashPassword(password) },
        select: { id: true, name: true, email: true },
      });
      return sendSession(res, user, Boolean(req.body?.remember));
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }
      return next(error);
    }
  }

  async function login(req, res, next) {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!emailPattern.test(email) || !password || password.length > 128) {
        return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
      }

      const user = await database.user.findUnique({ where: { email } });
      const validPassword = await verifyPassword(password, user?.password || UNKNOWN_USER_HASH);
      if (!user || !validPassword) {
        return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
      }
      return sendSession(res, user, Boolean(req.body?.remember));
    } catch (error) {
      return next(error);
    }
  }

  async function currentUser(req, res, next) {
    try {
      const user = await database.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, name: true, email: true },
      });
      if (!user) return res.status(401).json({ success: false, message: 'Your session is no longer valid. Please sign in again.' });
      return res.status(200).json({ success: true, user });
    } catch (error) {
      return next(error);
    }
  }

  function logout(_req, res) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    return res.status(200).json({ success: true });
  }

  return { register, login, currentUser, logout };
}

function callHandler(name, req, res, next) {
  try {
    return createAuthHandlers(require('../prisma'))[name](req, res, next);
  } catch (error) {
    return next(error);
  }
}

const register = (req, res, next) => callHandler('register', req, res, next);
const login = (req, res, next) => callHandler('login', req, res, next);
const currentUser = (req, res, next) => callHandler('currentUser', req, res, next);
const logout = (req, res, next) => callHandler('logout', req, res, next);

module.exports = { register, login, currentUser, logout, createAuthHandlers };
