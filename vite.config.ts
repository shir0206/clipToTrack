import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: '/clipToTrack/',
  plugins: [react()],
  server: {
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/asset/**'],
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
