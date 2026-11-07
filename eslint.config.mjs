// Strict ESLint setup for the library (src/), the tests (tests/) and the example app (examples/)
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/', 'examples/dist/', '**/node_modules/', 'release/', 'docs/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: { react: { version: 'detect' } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Correctness
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-undef-init': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { functions: false }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
      'no-throw-literal': 'error',
      'no-param-reassign': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',
      'array-callback-return': 'error',
      'consistent-return': 'error',
      'default-case-last': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-alert': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'no-unneeded-ternary': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      radix: 'error',
      yoda: 'error',
      curly: ['error', 'all'],
      // React
      'react/prop-types': 'off',
      'react/jsx-key': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': 'error',
      'react/jsx-no-useless-fragment': 'error',
      'react/no-array-index-key': 'error',
      'react/function-component-definition': ['error', { namedComponents: 'function-declaration' }],
      'react-hooks/exhaustive-deps': 'error',
      // TypeScript
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // React event handlers are one-line arrows that call a state setter
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  // Plain config files are not part of a TypeScript project: no type-aware rules there
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false } },
  },
  // Formatting belongs to Prettier (npm run format), so ESLint formatting rules are switched off
  prettier,
];
