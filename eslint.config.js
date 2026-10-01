// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/', '**/coverage/', '**/node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['*.{js,ts}', 'apps/server/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/miniapp/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // core is pure calculation code (SPEC §8, §9.3): no DB, bot, HTTP, Node APIs or app code.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@pokerledger/server', '@pokerledger/miniapp'],
              message: 'core must not depend on apps.',
            },
            {
              group: ['@pokerledger/shared'],
              message: 'core must not depend on shared (shared may depend on core).',
            },
            {
              group: [
                'better-sqlite3',
                'drizzle-orm',
                'drizzle-orm/*',
                'grammy',
                'grammy/*',
                '@grammyjs/*',
                'hono',
                'hono/*',
                '@hono/*',
                '@tma.js/*',
                'react',
                'react-dom',
              ],
              message: 'core must stay free of DB, bot, HTTP and UI dependencies.',
            },
            {
              group: ['node:*'],
              message: 'core must run in the browser too; no Node built-ins.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
