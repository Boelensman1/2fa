import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'clipanion'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadVault: vi.fn(),
  setSyncServerUrl: vi.fn(),
  password: vi.fn(),
}))
vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: vi.fn(),
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))
vi.mock('@inquirer/prompts', () => ({ password: mocks.password }))

import SetServerUrlCommand from '../src/commands/sync/setServerUrl.mjs'

describe('sync setServerUrl', () => {
  let directory: string
  const settings = { vaultLocation: '/unused', syncIntervalMinutes: 5 }

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.stubEnv('FAVACLI_SYNC_SERVER_URL', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET_FILE', undefined)
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-server-'))
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault',
      settings,
    })
    mocks.loadVault.mockResolvedValue({
      setSyncServerUrl: mocks.setSyncServerUrl,
    })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const run = async (...args: string[]) => {
    const cli = new Cli()
    cli.register(SetServerUrlCommand)
    const command = cli.process([
      'sync',
      'setServerUrl',
      'wss://explicit.example.com',
      ...args,
    ])
    return command.execute()
  }

  it('reads --secret-file and opens the vault without connecting to old settings', async () => {
    vi.stubEnv('FAVACLI_SYNC_SERVER_URL', 'invalid-but-overridden')
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET_FILE', '/missing-but-overridden')
    const secretFile = path.join(directory, 'secret')
    await fs.writeFile(secretFile, 'file-secret\n')

    await run('--secret-file', secretFile, '--force')

    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault',
      settings,
      expect.any(Function),
      undefined,
      { connectToSyncServer: false },
    )
    expect(mocks.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://explicit.example.com',
      'file-secret',
      true,
    )
    expect(mocks.password).not.toHaveBeenCalled()
  })

  it('uses an environment secret without requiring an environment URL', async () => {
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', 'env-secret')
    await run()
    expect(mocks.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://explicit.example.com',
      'env-secret',
      undefined,
    )
    expect(mocks.password).not.toHaveBeenCalled()
  })

  it('prompts once when no secret source is provided', async () => {
    mocks.password.mockResolvedValue('prompt-secret')
    await run()
    expect(mocks.password).toHaveBeenCalledTimes(1)
    expect(mocks.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://explicit.example.com',
      'prompt-secret',
      undefined,
    )
  })

  it('does not prompt or change the server for an unreadable file', async () => {
    await expect(
      run('--secret-file', path.join(directory, 'missing')),
    ).rejects.toThrow('Could not read the server secret file')
    expect(mocks.password).not.toHaveBeenCalled()
    expect(mocks.setSyncServerUrl).not.toHaveBeenCalled()
  })
})
