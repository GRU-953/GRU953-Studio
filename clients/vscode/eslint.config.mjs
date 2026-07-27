// Flat ESLint config (ESLint 10+ dropped support for the legacy
// .eslintrc.json format this replaced). Carries the exact same rules as the
// old config, just in the new shape: eslint:recommended +
// plugin:@typescript-eslint/recommended, parsing .ts files with ecmaVersion
// 2020 / sourceType module, ignoring out/ and generated .d.ts files.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  { ignores: ['out/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
      },
    },
  },
];
