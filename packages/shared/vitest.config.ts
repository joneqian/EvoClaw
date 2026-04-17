import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',

    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,

    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 2,
        minForks: 1,
      },
    },

    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
});
