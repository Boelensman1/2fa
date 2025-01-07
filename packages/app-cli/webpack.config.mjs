import path from 'path'

const __dirname = import.meta.dirname

const config = {
  entry: './src/main.mts', // your main entry file
  target: 'node',
  module: {
    rules: [
      // all files with a `.ts`, `.cts`, `.mts` or `.tsx` extension will be handled by `ts-loader`
      {
        test: /\.([cm]?ts|tsx)$/,
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.build.json'),
        },
      },
      {
        test: /\.node$/,
        loader: 'node-loader',
      },
    ],
  },
  resolve: {
    // Add `.ts` and `.tsx` as a resolvable extension.
    extensions: ['.ts', '.tsx', '.js'],
    // Add support for TypeScripts fully qualified ESM imports.
    extensionAlias: {
      '.js': ['.js', '.ts'],
      '.cjs': ['.cjs', '.cts'],
      '.mjs': ['.mjs', '.mts'],
    },
  },
  optimization: {
    splitChunks: false, // Prevents code splitting
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
  },
}

export default config
