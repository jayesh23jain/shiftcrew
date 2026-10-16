import { defineConfig } from 'vitest/config';
// Needs a MongoDB-compatible server. Defaults to a local one; override with TEST_MONGO_URI.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGO_URI: process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/shiftcrew_test',
      JWT_ACCESS_SECRET: 'integration-test-secret-1234567890',
      PAYMENT_PROVIDER: 'mock',
      PLATFORM_FEE_PERCENT: '2',
      ENABLE_SCHEDULER: 'false',
    },
  },
});
