import sharedConfig from 'wtf-devconfigs/eslints/vite-react.mjs'
import globals from 'globals'

export default [
  {
    ignores: ['.output/**', '.wxt/**', 'postcss.config.mjs'],
  },
  // dev-configs currently does not have types yet
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  ...sharedConfig,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
      },
    },
  },
  {
    rules: {
      'n/no-missing-import': 'off',
    },
  },
  {
    files: ['wxt.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: [
      'entrypoints/**/*.ts',
      'entrypoints/**/*.tsx',
      'lib/**/*.ts',
      'lib/**/*.tsx',
    ],
    languageOptions: {
      globals: {
        global: 'readonly', // for vitest testing
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]
