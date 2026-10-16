import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';

const secret = () => env.QR_SECRET || `qr:${env.JWT_ACCESS_SECRET}`;
export const QR_TTL_SECONDS = 60;

// A QR pass proves "this volunteer holds a confirmed spot on this shift" for 60 seconds, once.
export function signPass({ signupId, userId, shiftId }) {
  const jti = crypto.randomBytes(12).toString('hex');
  const token = jwt.sign({ sid: String(signupId), uid: String(userId), shf: String(shiftId), jti }, secret(), {
    expiresIn: QR_TTL_SECONDS,
    algorithm: 'HS256',
  });
  return { token, expiresAt: new Date(Date.now() + QR_TTL_SECONDS * 1000) };
}

export function verifyPass(token) {
  return jwt.verify(token, secret(), { algorithms: ['HS256'] });
}
