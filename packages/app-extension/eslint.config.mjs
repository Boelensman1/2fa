import sharedConfig from '@wtflegal/dev-configs/eslints/vite-react.mjs'

export default [
  {
    ignores: ['build/**'],
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
]
