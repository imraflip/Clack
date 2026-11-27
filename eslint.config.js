import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const INTERNAL_PATTERNS = ['**/.internal/**', '.internal/**'];

// Forbidden Import DAG (.internal/ARCHITECTURE.md §1)
const SHARED_FORBIDDEN = [
  ...INTERNAL_PATTERNS,
  'three',
  'three/*',
  'hono',
  'hono/*',
  '@hono/*',
  'node:*',
  '@devvit/*',
  '**/client/**',
  '**/server/**',
];
const CLIENT_FORBIDDEN = [...INTERNAL_PATTERNS, '**/server/**', '@devvit/web/server', '@devvit/public-api'];
const SPLASH_FORBIDDEN = [...CLIENT_FORBIDDEN, 'three', 'three/*', './scene/*', './scene', './audio/*', './input/*', './ui/hud'];
const SERVER_FORBIDDEN = [...INTERNAL_PATTERNS, '**/client/**', 'three', 'three/*', '@devvit/web/client', '@devvit/public-api'];

const restrict = (patterns) => ['error', { patterns: [{ group: patterns, message: 'Forbidden by the CLACK import DAG.' }] }];

export default defineConfig([
  {
    ignores: ['.internal/**', 'dist/**', 'node_modules/**', 'coverage/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])', message: 'Type casts are forbidden.' },
        { selector: 'TSTypeAssertion', message: 'Type casts are forbidden.' },
        { selector: 'TSNonNullExpression', message: 'Non-null assertions are forbidden.' },
      ],
    },
  },
  {
    files: ['src/client/**/*.ts'],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': restrict(CLIENT_FORBIDDEN),
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: 'Redis is the only persistence on Reddit.' },
        { object: 'window', property: 'location', message: 'Forbidden inside Devvit WebViews.' },
        { object: 'window', property: 'alert', message: 'Forbidden inside Devvit WebViews.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Redis is the only persistence on Reddit.' },
        { name: 'location', message: 'Forbidden inside Devvit WebViews.' },
        { name: 'alert', message: 'Forbidden inside Devvit WebViews.' },
      ],
    },
  },
  {
    files: ['src/client/splash.ts'],
    rules: { 'no-restricted-imports': restrict(SPLASH_FORBIDDEN) },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict(SHARED_FORBIDDEN),
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'src/shared must stay deterministic.' },
        { name: 'performance', message: 'src/shared must stay deterministic.' },
        { name: 'window', message: 'src/shared is DOM-free.' },
        { name: 'document', message: 'src/shared is DOM-free.' },
        { name: 'process', message: 'src/shared is Node-free.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'src/shared must stay deterministic.' },
        { object: 'Date', property: 'now', message: 'src/shared must stay deterministic.' },
        { object: 'performance', property: 'now', message: 'src/shared must stay deterministic.' },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-imports': restrict(SERVER_FORBIDDEN) },
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
  },
]);
