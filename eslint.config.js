// @ts-check
import path from 'node:path';
import js from '@eslint/js';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import tseslint from 'typescript-eslint';

const gitignorePath = path.join(import.meta.dirname, '.gitignore');

/** Keeps each package inside its architectural boundary. */
const restrictImports = (/** @type {{ group: string[], message: string }[]} */ patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default defineConfig(
  includeIgnoreFile(gitignorePath, 'Patterns from .gitignore'),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template strings are everywhere in game and UI code, and always safe.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['shared/**/*.ts'],
    rules: restrictImports([
      {
        group: ['three', 'three/*', '@colyseus/*', 'node:*', '@extinct/client', '@extinct/server'],
        message:
          'shared/ runs on both client and server: keep it free of rendering, networking and Node APIs.',
      },
    ]),
  },
  {
    files: ['client/**/*.ts'],
    ignores: ['client/vite.config.ts'],
    rules: restrictImports([
      {
        group: ['@extinct/server', '@colyseus/core', '@colyseus/ws-transport', 'node:*'],
        message: 'client/ is browser code: share logic through @extinct/shared instead.',
      },
    ]),
  },
  {
    files: ['server/**/*.ts'],
    rules: restrictImports([
      {
        group: ['three', 'three/*', '@extinct/client'],
        message: 'server/ must not depend on rendering or client code.',
      },
    ]),
  },
);
