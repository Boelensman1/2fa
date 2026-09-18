import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'clipanion'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadVault: vi.fn(),
  saveSettings: vi.fn(),
  password: vi.fn(),
  input: vi.fn(),
  confirm: vi.fn(),
  setPassword: vi.fn(),
  getPasswordStrength: vi.fn(),
  createNewFavaLibVault: vi.fn(),
  getFavaLibVaultCreationUtils: vi.fn(),
}))

vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: mocks.saveSettings,
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))
vi.mock('@inquirer/prompts', () => ({
  password: mocks.password,
  input: mocks.input,
  confirm: mocks.confirm,
}))
vi.mock('keytar', () => ({
  default: { setPassword: mocks.setPassword, getPassword: vi.fn() },
}))
vi.mock('favalib', () => ({
  getFavaLibVaultCreationUtils: mocks.getFavaLibVaultCreationUtils,
  FavaLibEvent: {
    ConnectToExistingVaultFinished: 'connectToExistingVaultFinished',
  },
}))
vi.mock('favalib/platformProviders/node', () => ({ default: {} }))

import SetupCommand from '../src/commands/setup.mjs'

const STRONG = 'correct horse battery staple'

/**
 * Builds a fake FavaLib whose sync calls are all observable.
 * @returns The fake, with its registered event listeners exposed.
 */
const makeFavaLib = () => {
  const listeners: (() => void)[] = []
  return {
    listeners,
    storage: { forceSave: vi.fn().mockResolvedValue(undefined) },
    setSyncServerUrl: vi.fn().mockResolvedValue(undefined),
    setDeviceFriendlyName: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((_event: string, cb: () => void) => {
      listeners.push(cb)
    }),
    sync: {
      webSocketConnected: true,
      closeServerConnection: vi.fn(),
      flushCommandSendQueue: vi.fn().mockResolvedValue(true),
      // Fires the completion event the command is waiting on, the way a real
      // import does once the initial vault has landed.
      respondToAddDeviceFlow: vi.fn(() => {
        listeners.forEach((cb) => cb())
        return Promise.resolve()
      }),
    },
  }
}

describe('setup', () => {
  let directory: string
  let vaultLocation: string
  let favaLib: ReturnType<typeof makeFavaLib>
  let written: string

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.stubEnv('FAVACLI_SYNC_SERVER_URL', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', undefined)
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET_FILE', undefined)

    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-setup-'))
    vaultLocation = path.join(directory, 'vault.json')
    written = ''

    mocks.init.mockResolvedValue({
      lockedRepresentationString: null,
      settings: { vaultLocation, syncIntervalMinutes: 5 },
    })

    favaLib = makeFavaLib()
    mocks.createNewFavaLibVault.mockResolvedValue({ favaLib })
    mocks.getPasswordStrength.mockResolvedValue({
      score: 4,
      feedback: { warning: '', suggestions: [] },
    })
    mocks.getFavaLibVaultCreationUtils.mockReturnValue({
      getPasswordStrength: mocks.getPasswordStrength,
      createNewFavaLibVault: mocks.createNewFavaLibVault,
    })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const run = async (...args: string[]) => {
    const cli = new Cli()
    cli.register(SetupCommand)
    const command = cli.process(['setup', ...args])
    command.context = {
      stdout: {
        write: (chunk: string) => {
          written += chunk
          return true
        },
      },
      stderr: { write: () => true },
    } as unknown as typeof command.context
    return command.execute()
  }

  it('refuses when a vault already exists, and creates nothing', async () => {
    mocks.init.mockResolvedValue({
      lockedRepresentationString: 'existing-vault',
      settings: { vaultLocation, syncIntervalMinutes: 5 },
    })

    await expect(run()).rejects.toThrow('A vault already exists')

    expect(mocks.createNewFavaLibVault).not.toHaveBeenCalled()
    expect(mocks.setPassword).not.toHaveBeenCalled()
    expect(mocks.password).not.toHaveBeenCalled()
  })

  it('creates a vault and stops when sync is declined', async () => {
    mocks.password.mockResolvedValue(STRONG)
    mocks.confirm.mockResolvedValue(false)

    await run()

    expect(mocks.createNewFavaLibVault).toHaveBeenCalledWith(STRONG)
    expect(favaLib.storage.forceSave).toHaveBeenCalled()
    expect(mocks.setPassword).toHaveBeenCalledWith(
      'favacli',
      'vault-password',
      STRONG,
    )
    expect(favaLib.setSyncServerUrl).not.toHaveBeenCalled()
    expect(written).toContain('favacli sync setServerUrl')
  })

  it('re-prompts when the two passwords differ', async () => {
    mocks.password
      .mockResolvedValueOnce(STRONG)
      .mockResolvedValueOnce('something else')
      .mockResolvedValue(STRONG)
    mocks.confirm.mockResolvedValue(false)

    await run()

    expect(written).toContain("Passwords don't match")
    expect(mocks.password).toHaveBeenCalledTimes(4)
    expect(mocks.createNewFavaLibVault).toHaveBeenCalledTimes(1)
    expect(mocks.createNewFavaLibVault).toHaveBeenCalledWith(STRONG)
  })

  it('re-prompts on a weak password without trying to create a vault with it', async () => {
    mocks.password
      .mockResolvedValueOnce('weak')
      .mockResolvedValueOnce('weak')
      .mockResolvedValue(STRONG)
    mocks.getPasswordStrength
      .mockResolvedValueOnce({
        score: 1,
        feedback: {
          warning: 'This is a top-10 common password',
          suggestions: ['Add a word or two'],
        },
      })
      .mockResolvedValue({
        score: 4,
        feedback: { warning: '', suggestions: [] },
      })
    mocks.confirm.mockResolvedValue(false)

    await run()

    expect(written).toContain('too weak')
    expect(written).toContain('This is a top-10 common password')
    expect(written).toContain('Add a word or two')
    expect(mocks.createNewFavaLibVault).toHaveBeenCalledTimes(1)
    expect(mocks.createNewFavaLibVault).toHaveBeenCalledWith(STRONG)
  })

  it('configures the sync server and stops when import is declined', async () => {
    mocks.password.mockResolvedValueOnce(STRONG).mockResolvedValueOnce(STRONG)
    mocks.password.mockResolvedValueOnce('prompted-secret')
    mocks.input.mockResolvedValue('wss://sync.example.com')
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await run()

    expect(favaLib.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://sync.example.com',
      'prompted-secret',
    )
    expect(favaLib.sync.respondToAddDeviceFlow).not.toHaveBeenCalled()
    expect(written).toContain('favacli sync connect')
  })

  it('reads the secret from --secret-file without prompting for it', async () => {
    const secretFile = path.join(directory, 'secret')
    await fs.writeFile(secretFile, 'file-secret\n')

    mocks.password.mockResolvedValue(STRONG)
    mocks.input.mockResolvedValue('wss://sync.example.com')
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await run('--secret-file', secretFile)

    expect(favaLib.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://sync.example.com',
      'file-secret',
    )
    // Twice for the vault password, and not a third time for the secret.
    expect(mocks.password).toHaveBeenCalledTimes(2)
  })

  it('reads the secret from the environment without prompting for it', async () => {
    vi.stubEnv('FAVACLI_SYNC_SERVER_SECRET', 'env-secret')

    mocks.password.mockResolvedValue(STRONG)
    mocks.input.mockResolvedValue('wss://sync.example.com')
    mocks.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await run()

    expect(favaLib.setSyncServerUrl).toHaveBeenCalledWith(
      'wss://sync.example.com',
      'env-secret',
    )
    expect(mocks.password).toHaveBeenCalledTimes(2)
  })

  it('imports an existing vault through the pairing flow', async () => {
    mocks.password.mockResolvedValue(STRONG)
    mocks.input
      .mockResolvedValueOnce('wss://sync.example.com') // server address
      .mockResolvedValueOnce('My Laptop') // friendly name
      .mockResolvedValueOnce('pairing-string') // connection string
    mocks.confirm.mockResolvedValue(true)

    await run()

    expect(favaLib.setDeviceFriendlyName).toHaveBeenCalledWith('My Laptop')
    expect(favaLib.sync.respondToAddDeviceFlow).toHaveBeenCalledWith(
      'pairing-string',
      'text',
    )
    expect(written).toContain('Vault imported.')
  })

  it('does not attempt an import when the server refuses the secret', async () => {
    favaLib.setSyncServerUrl.mockRejectedValue(
      new Error(
        'Failed to connect to server at wss://sync.example.com, not setting',
      ),
    )
    mocks.password.mockResolvedValue(STRONG)
    mocks.input.mockResolvedValue('wss://sync.example.com')
    mocks.confirm.mockResolvedValue(true)

    await expect(run()).rejects.toThrow('Failed to connect to server')

    expect(favaLib.sync.respondToAddDeviceFlow).not.toHaveBeenCalled()
    // The vault itself was still created, so the user can retry the sync half.
    expect(favaLib.storage.forceSave).toHaveBeenCalled()
  })

  it('reports what was set up when the user cancels at a prompt', async () => {
    mocks.password.mockResolvedValue(STRONG)
    const cancellation = new Error('User force closed the prompt')
    cancellation.name = 'ExitPromptError'
    mocks.confirm.mockRejectedValue(cancellation)

    await run()

    expect(written).toContain('Setup cancelled.')
    expect(written).toContain('favacli sync setServerUrl')
    expect(favaLib.storage.forceSave).toHaveBeenCalled()
  })
})
