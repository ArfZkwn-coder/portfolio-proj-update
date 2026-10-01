import js from '@eslint/js';
import globals from 'globals';

// Paths are relative to the project root; run with: npm run lint
export default [
  js.configs.recommended,
  { files: ['js/main.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } } },
  { files: ['js/totem.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } } },
  { files: ['test/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } } },
];
