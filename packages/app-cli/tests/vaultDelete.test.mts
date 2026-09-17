import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import VaultDeleteCommand from '../src/commands/vault/delete.mjs'

describe('vault delete', () => {
  let directory: string
  let vaultLocation: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-delete-'))
    vaultLocation = path.join(directory, 'vault.json')
    mocks.init.mockResolvedValue({
      lockedRepresentationString: undefined,
      settings: { vaultLocation, syncIntervalMinutes: 5 },
    })
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
    mocks.init.mockReset()
    mocks.saveSettings.mockReset()
  })

  const run = async () => {
    const command = new VaultDeleteCommand()
    command.force = true
    command.forceSync = false
    command.noSync = true
    command.verbose = false
    command.format = undefined
    command.context = {
      stdout: { write: () => true },
    } as unknown as typeof command.context
    await command.execute()
  }

  const exists = async (file: string) =>
    await fs
      .access(file)
      .then(() => true)
      .catch(() => false)

  it('removes the backup and the temp file along with the vault', async () => {
    // loadVault writes a backup on every save and never removes one, so a vault
    // whose backup survives an explicit delete is not actually deleted -- and
    // copying it back over vault.json silently reverts the vault, which no
    // authenticator over a single file can detect.
    await fs.writeFile(vaultLocation, '{"storageVersion":2}')
    await fs.writeFile(`${vaultLocation}.backup`, '{"storageVersion":2}')
    await fs.writeFile(`${vaultLocation}.tmp`, '{"storageVersion":2}')

    await run()

    expect(await exists(vaultLocation)).toBe(false)
    expect(await exists(`${vaultLocation}.backup`)).toBe(false)
    expect(await exists(`${vaultLocation}.tmp`)).toBe(false)
  })

  it('succeeds when there is no backup or temp file to remove', async () => {
    await fs.writeFile(vaultLocation, '{"storageVersion":2}')

    await expect(run()).resolves.not.toThrow()

    expect(await exists(vaultLocation)).toBe(false)
  })
})
