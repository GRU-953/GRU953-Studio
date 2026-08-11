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
// 2026-07-31 maintenance fix: the `test/**/*.test.mjs` files live outside
// `src/`, so the original single `files: ['src/**/*.js']` block never
// covered them, and ci.yml's repo-wide `node --check` step prunes
// `./clients` too — so nothing here lint-checked the test suite itself.
// Test files are ES modules (`import`/`export`, `node:test`), not the
// plain CommonJS of src/, so they need their own languageOptions block
// rather than being folded into the existing one.
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
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // 2026-08-11: scripts/ holds the pack-time bundler, which is ESM rather than the
  // CommonJS used in src/. It went unlinted until the lint script was widened to
  // cover it, at which point `console` was reported undefined — the same gap a
  // 2026-07-29 fix closed for the clients/ packages as a whole.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
];
