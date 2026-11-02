import js from '@eslint/js';
import globals from 'globals';

// Paths are relative to the project root; run with: npm run lint
export default [
  js.configs.recommended,
  { files: ['js/main.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } } },
  {
    // A browser script that also exports its pure helpers for Node tests, so
    // `module` is a legitimate global here.
    files: ['js/tracking.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable' },
    },
  },
  {
    // relay/lib.js is deliberately environment-agnostic: pure functions that
    // run both in a Worker and under plain `node`, so it needs the Web platform
    // globals neither preset provides. worker.js additionally uses the Workers
    // request context, which it declares for itself.
    files: ['relay/lib.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { crypto: 'readonly', TextEncoder: 'readonly' } },
  },
  { files: ['relay/worker.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module' } },
  { files: ['test/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } } },
];
