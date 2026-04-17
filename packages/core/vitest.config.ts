import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@evoclaw/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],

    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,

    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 4,
        minForks: 1,
      },
    },

    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        'build.ts',
        'dist/**',
        'coverage/**',
        '**/*.config.ts',
      ],
    },
  },
});
