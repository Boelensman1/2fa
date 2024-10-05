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

export default [
  {
    ignores: ['**/build/**', '**/dist/**', '**/*.js'],
  },
  ...baseConfig,
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
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
]
