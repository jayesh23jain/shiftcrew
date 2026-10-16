import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env, isProd } from '../config/env.js';

export const REFRESH_COOKIE = 'sc_refresh';

export function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    expiresIn: env.ACCESS_TTL,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}

export const newRefreshToken = () => crypto.randomBytes(48).toString('hex');
export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    maxAge: env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}
