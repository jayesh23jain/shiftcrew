import rateLimit from 'express-rate-limit';

const make = (limit, message) =>
  rateLimit({ windowMs: 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: { message } } });

export const joinLimiter = make(30, 'You are joining shifts too quickly. Wait a moment.');
export const scanLimiter = make(120, 'Too many scans. Wait a moment.');
export const moneyLimiter = make(20, 'Too many payment requests. Wait a moment.');
export const missionLimiter = make(60, 'Too many mission control requests. Please wait a moment.');
export const swapLimiter = make(30, 'Too many shift swap actions. Please wait a moment.');
export const aiPlanLimiter = make(15, 'Too many AI requests. Please wait a moment before trying again.');

