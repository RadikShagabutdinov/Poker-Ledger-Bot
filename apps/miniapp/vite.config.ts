import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// VITE_BASE is '/<repo>/' for GitHub Pages (SPEC §16.3) and '/' locally.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: {
    name: '@pokerledger/miniapp',
    environment: 'node',
  },
});
