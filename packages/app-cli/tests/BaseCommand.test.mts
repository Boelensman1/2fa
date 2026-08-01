import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import BaseCommand from '../src/BaseCommand.mjs'

class TestCommand extends BaseCommand {
  requireFavaLib = true

  async exec() {
    return Promise.resolve({ success: true })
  }
}

const now = 1_750_000_000_000

const makeFavaLib = (connected: boolean) => ({
  sync: {
    webSocketConnected: connected,
    closeServerConnection: vi.fn(),
  },
})

const makeCommand = () => {
  const command = new TestCommand()
  command.forceSync = false
  command.noSync = false
  command.verbose = false
  command.format = undefined
  return command
}

describe('BaseCommand sync lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.init.mockReset()
    mocks.loadVault.mockReset()
    mocks.saveSettings.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(now)
  })

  it('records a successful sync and passes the online load option', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(true))

    await makeCommand().execute()

    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault-data',
      settings,
      expect.any(Function),
      false,
      true,
    )
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      ...settings,
      lastSyncedAt: now,
    })
  })

  it('loads offline and leaves the timestamp unchanged when sync is recent', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      lastSyncedAt: now - 1,
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(false))

    await makeCommand().execute()

    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault-data',
      settings,
      expect.any(Function),
      false,
      false,
    )
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('does not record failed sync attempts', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(false))

    await makeCommand().execute()

    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('rejects no-sync for commands that require a connection', async () => {
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings: {
        vaultLocation: '/tmp/vault.json',
        syncIntervalMinutes: 5,
      },
    })
    const command = makeCommand()
    command.requiresSyncConnection = true
    command.noSync = true

    await expect(command.execute()).rejects.toThrow(
      '--no-sync cannot be used with sync commands',
    )
    expect(mocks.loadVault).not.toHaveBeenCalled()
  })
})
