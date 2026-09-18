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

import BaseCommand from '../src/BaseCommand.mjs'

class TestCommand extends BaseCommand {
  requireFavaLib = true
  execCalls = 0

  async exec() {
    this.execCalls += 1
    return Promise.resolve({ success: true })
  }
}

const now = 1_750_000_000_000

const makeFavaLib = (connected: boolean, flushed = true) => ({
  sync: {
    webSocketConnected: connected,
    closeServerConnection: vi.fn(),
    flushCommandSendQueue: vi.fn().mockResolvedValue(flushed),
    diagnoseConnectionFailure: vi
      .fn()
      .mockResolvedValue(
        'Failed to connect to sync backend at ws://sync.example.com:8080/: ' +
          'the socket closed with code 1006 while still opening the ' +
          'connection. GET http://sync.example.com:8080/ failed: ECONNREFUSED',
      ),
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
    vi.stubEnv('FAVACLI_SYNC_SERVER_URL', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET_FILE', undefined)
  })

  afterEach(() => vi.unstubAllEnvs())

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
      { connectToSyncServer: true, syncServer: undefined },
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
      { connectToSyncServer: false, syncServer: undefined },
    )
    expect(mocks.saveSettings).not.toHaveBeenCalled()
  })

  it('applies runtime settings while respecting no-sync', async () => {
    vi.stubEnv('FAVACLI_SYNC_SERVER_URL', 'wss://sync.example.com')
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', 'runtime-secret')
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(false))
    const command = makeCommand()
    command.noSync = true

    await command.execute()

    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault-data',
      settings,
      expect.any(Function),
      {
        connectToSyncServer: false,
        syncServer: {
          serverUrl: 'wss://sync.example.com',
          serverSecret: 'runtime-secret',
        },
      },
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

  it('waits for queued commands to reach the server before closing', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    const favaLib = makeFavaLib(true)
    mocks.loadVault.mockResolvedValue(favaLib)

    await makeCommand().execute()

    expect(favaLib.sync.flushCommandSendQueue).toHaveBeenCalled()
    expect(
      favaLib.sync.flushCommandSendQueue.mock.invocationCallOrder[0],
    ).toBeLessThan(
      favaLib.sync.closeServerConnection.mock.invocationCallOrder[0],
    )
  })

  it('does not wait when the command never connected', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      lastSyncedAt: now - 1,
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    const favaLib = makeFavaLib(false)
    mocks.loadVault.mockResolvedValue(favaLib)

    await makeCommand().execute()

    expect(favaLib.sync.flushCommandSendQueue).not.toHaveBeenCalled()
  })

  it('reports an unflushed queue as an error in machine output', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(false, false))

    const command = makeCommand()
    command.format = 'json'
    const stdout: string[] = []
    // minimal stub of clipanion's context, only stdout is used here
    command.context = {
      stdout: {
        write: (chunk: string) => {
          stdout.push(chunk)
          return true
        },
      },
    } as unknown as typeof command.context

    await command.execute()

    expect(command.errors).toHaveLength(1)
    expect(command.errors[0].message).toMatch(/will be sent the next time/)
    const printed = JSON.parse(stdout.join('')) as { errors: unknown[] }
    expect(printed.errors).toHaveLength(1)
  })

  it('refuses a command that needs a live connection, before exec runs', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    const favaLib = makeFavaLib(false)
    mocks.loadVault.mockResolvedValue(favaLib)

    const command = makeCommand()
    command.requiresLiveSyncConnection = true

    await expect(command.execute()).rejects.toThrow(
      /at ws:\/\/sync\.example\.com:8080\/.*ECONNREFUSED.*has not run/s,
    )
    expect(favaLib.sync.diagnoseConnectionFailure).toHaveBeenCalled()
    expect(command.execCalls).toBe(0)
  })

  it('runs a command that needs a live connection once connected', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    const favaLib = makeFavaLib(true)
    mocks.loadVault.mockResolvedValue(favaLib)

    const command = makeCommand()
    command.requiresLiveSyncConnection = true

    await command.execute()

    expect(command.execCalls).toBe(1)
    expect(favaLib.sync.diagnoseConnectionFailure).not.toHaveBeenCalled()
  })

  it('refuses a command that needs a live connection with no server set', async () => {
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings: {
        vaultLocation: '/tmp/vault.json',
        syncIntervalMinutes: 5,
      },
    })
    mocks.loadVault.mockResolvedValue({ sync: undefined })

    const command = makeCommand()
    command.requiresLiveSyncConnection = true

    await expect(command.execute()).rejects.toThrow(
      'This command needs a sync server',
    )
    expect(command.execCalls).toBe(0)
  })

  it('connects for a live-connection command even when sync is recent', async () => {
    const settings = {
      vaultLocation: '/tmp/vault.json',
      lastSyncedAt: now - 1,
      syncIntervalMinutes: 5,
    }
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(true))

    const command = makeCommand()
    command.requiresLiveSyncConnection = true

    await command.execute()

    expect(mocks.loadVault).toHaveBeenCalledWith(
      'vault-data',
      settings,
      expect.any(Function),
      { connectToSyncServer: true, syncServer: undefined },
    )
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

describe('BaseCommand favalib log reporting', () => {
  const settings = { vaultLocation: '/tmp/vault.json', syncIntervalMinutes: 5 }

  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.init.mockReset()
    mocks.loadVault.mockReset()
    mocks.saveSettings.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'vault-data',
      settings,
    })
    mocks.loadVault.mockResolvedValue(makeFavaLib(true))
  })

  /**
   * Runs a command and hands back the reporter it gave loadVault, plus what it
   * wrote where.
   * @param configure - Applied to the command before it executes.
   * @returns The reporter, the captured streams and the command itself.
   */
  const reporterFor = async (
    configure: (c: BaseCommand) => void = () => undefined,
  ) => {
    const command = makeCommand()
    const stdout: string[] = []
    const stderr: string[] = []
    // minimal stub of clipanion's context: only the two streams are used
    command.context = {
      stdout: {
        write: (chunk: string) => {
          stdout.push(chunk)
          return true
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr.push(chunk)
          return true
        },
      },
    } as unknown as typeof command.context
    configure(command)

    await command.execute()

    // The last call, not the first: a test may run more than one command, and
    // each gets its own reporter bound to its own command instance.
    const report = mocks.loadVault.mock.calls.at(-1)![2] as (
      severity: string,
      message: string,
    ) => void
    return { command, report, stdout, stderr }
  }

  it('writes a warning as one plain line, with no Error and no stack', async () => {
    // The regression this exists for: warning and error were collapsed into
    // `new Error(message)` and handed to console.error, so an ordinary sync
    // notice arrived mid-prompt as `Error: ...` followed by the stack of the
    // listener that had just constructed it -- which pointed at nothing that
    // had failed.
    const { command, report, stderr } = await reporterFor()

    report('warning', 'alice added sync device "the phone" (cli, carol)')

    expect(stderr).toEqual([
      'alice added sync device "the phone" (cli, carol)\n',
    ])
    expect(stderr.join('')).not.toContain('Error')
    expect(stderr.join('')).not.toContain('    at ')
    expect(command.errors).toHaveLength(0)
  })

  it('prefixes an error, which favalib means differently', async () => {
    // favalib reserves 'error' for a refusal the user should hear about even
    // though the library carried on. Distinguishable from the ordinary noise of
    // a sync connection, because that is the distinction Events.mts draws.
    const { report, stderr } = await reporterFor()

    report('error', 'Refusing to add sync device carol')

    expect(stderr).toEqual(['Error: Refusing to add sync device carol\n'])
  })

  it('collects both into the errors array under --format', async () => {
    const { command, report, stderr } = await reporterFor((c) => {
      c.format = 'json'
    })

    report('warning', 'a notice')
    report('error', 'a refusal')

    expect(command.errors).toEqual([
      { timestamp: now, message: 'a notice' },
      { timestamp: now, message: 'Error: a refusal' },
    ])
    expect(stderr).toEqual([])
  })

  it('keeps info out of the way unless asked, and out of JSON always', async () => {
    const quiet = await reporterFor()
    quiet.report('info', 'Connected to server.')
    expect(quiet.stdout.join('')).not.toContain('Connected to server.')

    const verbose = await reporterFor((c) => {
      c.verbose = true
    })
    verbose.report('info', 'Connected to server.')
    expect(verbose.stdout.join('')).toContain('Connected to server.')

    // A diagnostic line on stdout in machine mode is a JSON document no
    // consumer can parse, which is why this goes through `output`.
    const machine = await reporterFor((c) => {
      c.format = 'json'
      c.verbose = true
    })
    const before = machine.stdout.join('')
    machine.report('info', 'Connected to server.')
    expect(machine.stdout.join('')).toBe(before)
  })
})
