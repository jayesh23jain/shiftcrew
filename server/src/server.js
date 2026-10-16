import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { startScheduler } from './services/scheduler.js';

await connectDB();
const app = createApp();
const server = app.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));

if (env.ENABLE_SCHEDULER === 'true') startScheduler();

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
