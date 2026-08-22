// Repo-tooling ESLint config (dev-only — see CONTRIBUTING.md's "A note on
// dependencies" section). Scoped to the plugin's own hook scripts, which are
// zero-runtime-dependency ESM (.mjs) — the `clients/` bridges each carry their
// own separate lint setup with their own lockfile (see clients/vscode's
// eslint.config.mjs, which replaced its old .eslintrc.json in PR #29),
// already wired into CI's `clients` job.
//
// The rule that matters most here: NOT listing CommonJS globals
// (`require`/`module`/`exports`/`__dirname`/`__filename`) makes referencing
// any of them a `no-undef` error under `sourceType: 'module'`. This is what
// would have caught, statically, a real defect from a prior audit: a
// `require()` call inside one of these ESM hook files, which throws
// `ReferenceError` at runtime and — because it was inside a caught block —
// was silently swallowed rather than failing loudly.
export default [
  {
    files: ['plugins/gru953-studio/hooks/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        globalThis: 'readonly',
        fetch: 'readonly',
        structuredClone: 'readonly',
        // 2026-08-22, X250: added when the one outbound `fetch` gained a timeout. `fetch` was
        // already listed and its companions were not, so `AbortSignal.timeout(...)` was a no-undef
        // error — correctly, because this list is a deliberate allow-list rather than an oversight
        // (see the header note on CommonJS globals). Both are Node globals from v15, well below this
        // project's Node 22 floor, and adding them is the fix rather than suppressing the rule.
        AbortSignal: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      // 'smart' allows the `x == null` idiom (catches both null and
      // undefined in one comparison) — already used correctly twice in this
      // codebase; a plain 'error'/'warn' would flag safe code as a defect.
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
    },
  },
  // 2026-08-10: tools/ holds the release-packaging scripts, which are dev-only
  // like the hooks above and equally zero-dependency ESM. They needed their own
  // entry rather than a widened glob because CI's repo-wide `node --check` sweep
  // prunes only ./clients — so before this, tools/ was syntax-checked but never
  // linted, the same gap a 2026-07-29 fix closed for the clients/ bridges.
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        globalThis: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
    },
  },
];
