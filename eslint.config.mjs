// @ts-check
import path from 'path'
import { fileURLToPath } from 'url'
import globals from 'globals'

import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import solidPlugin from 'eslint-plugin-solid'
import jsdoc from 'eslint-plugin-jsdoc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const baseConfig = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/recommended-typescript-error'],
)

const restrictedGlobals = [
  {
    name: 'Error',
    message: 'Use custom error instead.',
  },
  {
    name: 'Buffer',
    message: 'Use Uint8Array instead.',
  },
]

export default [
  {
    ignores: ['**/build/**', '**/dist/**', '**/*.js'],
  },
  ...baseConfig,
  {
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
        },
      ],
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./packages/*/tsconfig.json'],
      },
    },
  },
  {
    files: ['packages/app-browser/**'],
    plugins: {
      solid: solidPlugin,
    },
    rules: {
      ...solidPlugin.configs.recommended.rules,
      'no-restricted-globals': ['off'],
      'jsdoc/require-jsdoc': ['off'],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['packages/app-cli/**'],
    rules: {
      'no-restricted-globals': ['off'],
      'jsdoc/require-jsdoc': ['off'],
    },
  },
  {
    files: ['**/test/**'],
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals.filter(g => g.name !== 'Error')],
    },
  },
]
