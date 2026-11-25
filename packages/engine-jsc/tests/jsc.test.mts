/**
 * Runs the bundle on real JavaScriptCore with the JIT and WebAssembly off --
 * how an app's JSContext runs on iOS. Needs a `jsc` shell:
 *
 * - macOS ships one at
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
 * - elsewhere, `npx jsvu --engines=javascriptcore` installs ~/.jsvu/bin/jsc
 * - or point JSC at any jsc binary.
 *
 * Skipped when none is found.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, inject, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))

const findJsc = (): string | undefined => {
  const candidates = [
    process.env.JSC,
    '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc',
    path.join(os.homedir(), '.jsvu/bin/jsc'),
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  try {
    return (
      execFileSync('which', ['jsc'], { encoding: 'utf8' }).trim() || undefined
    )
  } catch {
    return undefined
  }
}

const jsc = findJsc()

describe.skipIf(!jsc)('on JavaScriptCore without JIT or WebAssembly', () => {
  it('loads the bundle and runs a full vault flow', () => {
    const output = execFileSync(
      jsc!,
      [
        '--useJIT=false',
        '--useWebAssembly=false',
        path.join(here, 'jsc/host.js'),
        inject('productionBundle'),
        path.join(here, 'jsc/smoke.js'),
      ],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    expect(output).toContain('JSC_SMOKE_OK')
  })
})
