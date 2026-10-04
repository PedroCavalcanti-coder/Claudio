'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // scripts/legacy: migrações pontuais já aplicadas (Neon→local), mantidas só como referência
  { ignores: ['node_modules/**', 'logs/**', 'coverage/**', 'scripts/legacy/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.jest } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['**/*.mjs'], languageOptions: { sourceType: 'module', ecmaVersion: 2023, globals: { ...globals.node } } },
];
