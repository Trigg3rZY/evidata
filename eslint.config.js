import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config (ESLint 10). Type-checked rules via typescript-eslint's project
// service; Prettier owns formatting (eslint-config-prettier disables conflicts).
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/drizzle/**', // generated migrations
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Config files are not part of a typed project.
    files: ['**/*.config.{js,ts,mjs}', '**/scripts/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // React component files: enforce the rules of hooks.
    files: ['apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Tests exercise dynamic DB rows; relax the type-unsafe rules there.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  eslintConfigPrettier,
);
