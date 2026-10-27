import http from 'http';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';
import { initSocketServer } from './socket.js';

const app = createApp();

if (!process.env.VERCEL) {
  await connectDB();
  const server = http.createServer(app);
  initSocketServer(server);
  server.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));

  if (env.ENABLE_SCHEDULER) startScheduler();

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
} else {
  // Warm up connection in background during Vercel cold starts
  connectDB().catch((err) => console.error('MongoDB warmup connection error:', err?.message || err));
}

export default app;

