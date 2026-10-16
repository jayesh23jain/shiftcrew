import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/users.routes.js';
import orgRoutes from './modules/orgs/orgs.routes.js';
import eventRoutes from './modules/events/events.routes.js';
import shiftRoutes from './modules/shifts/shifts.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import walletRoutes, { razorpayWebhook } from './modules/wallet/wallet.routes.js';
import payoutRoutes from './modules/payouts/payouts.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';
import communityRoutes from './modules/community/community.routes.js';
import reportRoutes from './modules/reports/reports.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  // The Razorpay webhook needs the raw bytes to verify its signature, so it is registered before express.json.
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '100kb' }), razorpayWebhook);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/orgs', orgRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/payouts', payoutRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);
  // These routers declare their own full paths (/events/:id/shifts, /shifts/:id, /me/..., /certificates/...)
  app.use('/api', shiftRoutes);
  app.use('/api', communityRoutes);
  app.use('/api', reportRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
