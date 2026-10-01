import { defineConfig } from 'tsdown';

// Workspace packages are consumed as TS sources, so they are bundled in.
// npm dependencies (including those imported by workspace packages) stay external
// and must be listed in this package's dependencies.
export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  fixedExtension: false,
  dts: false,
  deps: {
    neverBundle: true,
    alwaysBundle: [/^@pokerledger\//],
    onlyBundle: false,
  },
});
