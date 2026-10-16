import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../../models/User.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiError } from '../../utils/ApiError.js';
import { env } from '../../config/env.js';
import {
  REFRESH_COOKIE,
  signAccessToken,
  newRefreshToken,
  hashToken,
  refreshCookieOptions,
} from '../../utils/tokens.js';
import { registerSchema, loginSchema } from './auth.schemas.js';

const router = Router();

const MAX_SESSIONS = 5;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// Creates a refresh token, stores only its hash, and sets the cookie.
async function startSession(user, req, res) {
  const raw = newRefreshToken();
  const entry = {
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    userAgent: (req.headers['user-agent'] || '').slice(0, 200),
  };
  const now = new Date();
  const active = (user.refreshTokens || []).filter((t) => t.expiresAt > now);
  const trimmed = active.slice(-(MAX_SESSIONS - 1));
  user.refreshTokens = [...trimmed, entry];
  await user.save();
  res.cookie(REFRESH_COOKIE, raw, refreshCookieOptions());
}

router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.valid.body;
    const exists = await User.exists({ email });
    if (exists) throw ApiError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role });
    const full = await User.findById(user._id).select('+refreshTokens');
    await startSession(full, req, res);

    res.status(201).json({ user, accessToken: signAccessToken(user) });
  })
);

router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.valid.body;
    const user = await User.findOne({ email }).select('+passwordHash +refreshTokens');
    const genericError = ApiError.unauthorized('Incorrect email or password');

    if (!user) throw genericError;
    if (user.status === 'suspended') throw ApiError.forbidden('This account has been suspended');
    if (user.lockUntil && user.lockUntil > new Date()) {
      throw ApiError.tooMany('Too many failed attempts. Try again in a few minutes.');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILED_LOGINS) {
        user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        user.failedLogins = 0;
      }
      await user.save();
      throw genericError;
    }

    user.failedLogins = 0;
    user.lockUntil = undefined;
    await startSession(user, req, res);
    res.json({ user, accessToken: signAccessToken(user) });
  })
);

// Rotating refresh: the old token is deleted and a new one issued on every call.
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw ApiError.unauthorized('No session found');

    const tokenHash = hashToken(raw);
    const user = await User.findOne({ 'refreshTokens.tokenHash': tokenHash }).select('+refreshTokens');
    const stored = user?.refreshTokens.find((t) => t.tokenHash === tokenHash);

    if (!user || !stored || stored.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
      throw ApiError.unauthorized('Your session has expired. Please log in again');
    }
    if (user.status === 'suspended') throw ApiError.forbidden('This account has been suspended');

    user.refreshTokens = user.refreshTokens.filter((t) => t.tokenHash !== tokenHash);
    await startSession(user, req, res);
    res.json({ user, accessToken: signAccessToken(user) });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      await User.updateOne(
        { 'refreshTokens.tokenHash': hashToken(raw) },
        { $pull: { refreshTokens: { tokenHash: hashToken(raw) } } }
      );
    }
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  })
);

router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user.id }, { $set: { refreshTokens: [] } });
    res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined });
    res.status(204).end();
  })
);

export default router;
