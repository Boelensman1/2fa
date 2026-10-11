/**
 * Bundles src/main.mts, favalib and every dependency into one classic script
 * for `JSContext.evaluateScript`. Run through `make build`.
 *
 * Three things here are what make favalib run without WebAssembly:
 *
 * - `hash-wasm` is aliased to shims/hash-wasm.mts (argon2id on the host).
 * - `openpgp` resolves to its lightweight build, whose argon2 lives in a
 *   separate `argon2id.min.mjs` -- and that file is swapped for
 *   shims/openpgp-argon2.mts. The default build inlines it, so it cannot be
 *   swapped there.
 * - `process.env.NODE_ENV` is defined. favalib's SyncManager reads it at load
 *   time, and a JSContext has no `process`, so without the substitution the
 *   bundle throws a ReferenceError as it loads. The value matters too:
 *   'development' would let the sync server url be any scheme rather than
 *   ws:// or wss://, and esbuild's own default for an unminified browser build
 *   is exactly that.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Options for buildEngine. */
export interface BuildEngineOptions {
  /** Where to write the bundle. */
  outfile: string
  /** favalib's mode. */
  nodeEnv?: 'production' | 'development'
  /** Minify the output. */
  minify?: boolean
}

/**
 * Builds the engine bundle.
 * @param options - Where and how.
 * @returns The bundle's size in bytes.
 */
export const buildEngine = async ({
  outfile,
  nodeEnv = 'production',
  minify = true,
}: BuildEngineOptions): Promise<number> => {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/main.mts'],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    // The oldest JavaScriptCore this targets: iOS 16's.
    target: 'safari16',
    minify,
    // favalib's errors and the stack traces in host logs stay readable.
    keepNames: true,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    alias: { 'hash-wasm': './src/shims/hash-wasm.mts' },
    plugins: [
      {
        name: 'favaenginejsc-wasm-free',
        setup(build) {
          build.onResolve({ filter: /^openpgp$/ }, (args) =>
            build.resolve('openpgp/lightweight', {
              kind: args.kind,
              resolveDir: args.resolveDir,
            }),
          )
          build.onResolve({ filter: /\/argon2id(\.min)?\.mjs$/ }, (args) =>
            args.importer.includes(`${path.sep}openpgp${path.sep}`)
              ? { path: path.join(root, 'src/shims/openpgp-argon2.mts') }
              : undefined,
          )
        },
      },
    ],
  })
  const output = Object.values(result.metafile.outputs)[0]
  // A WebAssembly reference in the output means a dependency found a path
  // around the shims, and that path fails on iOS. Feature tests such as
  // `typeof WebAssembly` are fine, and so are string literals (openpgp matches
  // "WebAssembly.Memory.grow" in error messages); anything that compiles,
  // instantiates or allocates is not, the *Streaming variants included.
  const bundle = (await import('node:fs')).readFileSync(
    path.resolve(root, outfile),
    'utf8',
  )
  if (
    /(?<!["'`])WebAssembly\s*\.\s*(instantiate\w*|compile\w*|Module|Instance|Memory|Table|Global)\b/.test(
      bundle,
    )
  ) {
    // eslint-disable-next-line no-restricted-globals
    throw new Error(`${outfile} still references WebAssembly`)
  }
  return output.bytes
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await buildEngine({ outfile: 'build/fava-engine.js' })
  console.log(`build/fava-engine.js: ${(bytes / 1024).toFixed(0)} KiB`)
}
