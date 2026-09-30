import { defineConfig } from 'vitest/config';

const TEST_DB_PORT = 5434;

export default defineConfig({
  test: {
    globalSetup: './tests/global-setup.ts',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${TEST_DB_PORT}/postgres?sslmode=disable`,
      JWT_SECRET: 'test-only-secret-that-is-long-enough-for-validation',
    },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
