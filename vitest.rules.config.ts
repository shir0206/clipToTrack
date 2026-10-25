import { defineConfig } from 'vitest/config';

/** Security-rules tests. They need the Firestore emulator: `npm run test:rules` starts it for you. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['rules-tests/**/*.rules.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
