import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { LIB_VERSION, PAIRING_VERSION, STORAGE_VERSION } from 'favalib'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadVault: vi.fn(),
  saveSettings: vi.fn(),
}))

vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: mocks.saveSettings,
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))

import VersionCommand from '../src/commands/version.mjs'

const { version: packageVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string }

const run = async (format?: string) => {
  const command = new VersionCommand()
  command.forceSync = false
  command.noSync = true
  command.verbose = false
  command.format = format
  let written = ''
  command.context = {
    stdout: {
      write: (chunk: string) => {
        written += chunk
        return true
      },
    },
  } as unknown as typeof command.context
  await command.execute()
  return written
}

describe('version', () => {
  it('reports favacli, favalib and the format versions', async () => {
    const written = await run()

    expect(written).toContain(`favacli ${packageVersion}`)
    expect(written).toContain(`favalib ${LIB_VERSION}`)
    expect(written).toContain(`storage version ${String(STORAGE_VERSION)}`)
    expect(written).toContain(`pairing version ${PAIRING_VERSION}`)
  })

  it('reads neither the settings nor the vault', async () => {
    // The version is asked for when something else is broken, so this command
    // must answer without init() -- which would read the settings file, and
    // write one where there was none.
    await run()

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.saveSettings).not.toHaveBeenCalled()
    expect(mocks.loadVault).not.toHaveBeenCalled()
  })

  it('serializes the same versions under --format json', async () => {
    const written = await run('json')

    expect(JSON.parse(written)).toEqual({
      result: {
        favacli: packageVersion,
        favalib: LIB_VERSION,
        storageVersion: STORAGE_VERSION,
        pairingVersion: PAIRING_VERSION,
        node: process.version,
      },
      errors: [],
    })
  })
})
