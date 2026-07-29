// Flat ESLint config (ESLint 10+ dropped the legacy .eslintrc.json format).
// 2026-07-29 maintenance fix (audit finding 7): this package had no lint
// setup at all, and ci.yml's repo-wide `node --check` step explicitly prunes
// `./clients` — so nothing in this package's src/ was checked by CI beyond
// `npm test` exercising whatever the tests happen to import. Deliberately
// minimal, matching clients/vscode/eslint.config.mjs's own shape (the
// existing precedent for a clients/ package's lint setup) but adjusted for
// plain CommonJS `.js` rather than TypeScript: eslint:recommended only, no
// TypeScript plugin needed. `sourceType: 'commonjs'` recognises `require`/
// `module`/`exports` without listing them as globals; `__dirname`/
// `__filename` are not covered by that and are listed explicitly below.
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
];
