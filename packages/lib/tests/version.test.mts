import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

import { LIB_VERSION, STORAGE_VERSION } from '../src/main.mjs'

describe('version constants', () => {
  it('keeps LIB_VERSION in step with package.json', () => {
    // src/ cannot import ../package.json: tsconfig.build.json sets
    // rootDir to ./src. So the constant is written by hand, and this test is
    // what stops a release bumping package.json while every vault written
    // afterwards keeps claiming the old version.
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }

    expect(LIB_VERSION).toBe(pkg.version)
  })

  it('pins the storage version this build writes', () => {
    // Changing this is changing the at-rest format. If this assertion fails,
    // the change also needs a fixture for the new version (see
    // tests/fixtures/README.md) and a read path for the old one.
    expect(STORAGE_VERSION).toBe(1)
  })
})
