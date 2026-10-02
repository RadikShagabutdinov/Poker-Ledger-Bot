import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// One `.env` at the repo root serves the server and the Mini App (VITE_* only reach the app).
const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  return {
    // VITE_BASE is '/<repo>/' for GitHub Pages (SPEC §16.3) and '/' locally.
    base: env.VITE_BASE ?? '/',
    envDir,
    plugins: [react()],
    server: {
      // Dev: with VITE_API_URL unset the app calls /api on the Vite server, which forwards it
      // to `pnpm dev:server` — same origin, so CORS is not involved.
      proxy: { '/api': `http://localhost:${env.PORT || '3000'}` },
    },
    test: {
      name: '@pokerledger/miniapp',
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
