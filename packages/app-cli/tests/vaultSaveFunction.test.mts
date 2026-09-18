import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import createVaultSaveFunction from '../src/utils/vaultSaveFunction.mjs'

import type { LockedRepresentationString } from 'favalib'

const asVault = (s: string) => s as LockedRepresentationString

describe('createVaultSaveFunction', () => {
  let directory: string
  let vaultLocation: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-save-'))
    vaultLocation = path.join(directory, 'vault.json')
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  const read = async (file: string) => (await fs.readFile(file)).toString()

  const exists = async (file: string) =>
    await fs
      .access(file)
      .then(() => true)
      .catch(() => false)

  it('writes the vault and leaves no temp file behind', async () => {
    await createVaultSaveFunction(vaultLocation)(asVault('{"v":1}'))

    expect(await read(vaultLocation)).toBe('{"v":1}')
    expect(await exists(`${vaultLocation}.tmp`)).toBe(false)
  })

  it('creates no backup when there was no vault to back up', async () => {
    await createVaultSaveFunction(vaultLocation)(asVault('{"v":1}'))

    expect(await exists(`${vaultLocation}.backup`)).toBe(false)
  })

  it('keeps the previous vault as a backup when replacing one', async () => {
    const save = createVaultSaveFunction(vaultLocation)
    await save(asVault('{"v":1}'))
    await save(asVault('{"v":2}'))

    expect(await read(vaultLocation)).toBe('{"v":2}')
    expect(await read(`${vaultLocation}.backup`)).toBe('{"v":1}')
  })

  it('leaves the existing vault untouched when the write fails', async () => {
    // A directory where the temp file needs to go: writeFile fails, and the
    // vault already on disk must survive that rather than being truncated.
    await fs.writeFile(vaultLocation, '{"v":1}')
    await fs.mkdir(`${vaultLocation}.tmp`)
    // The cleanup path reports its own failure to remove the temp directory.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await expect(
      createVaultSaveFunction(vaultLocation)(asVault('{"v":2}')),
    ).rejects.toThrow()

    expect(await read(vaultLocation)).toBe('{"v":1}')
    consoleError.mockRestore()
  })
})
