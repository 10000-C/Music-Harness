import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.smoke.test.ts'],
    testTimeout: 45_000,
  },
});
