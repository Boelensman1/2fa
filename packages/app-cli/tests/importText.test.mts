import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'clipanion'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getFavaLibVaultCreationUtils } from 'favalib'
import type {
  DeviceType,
  FavaLib,
  LockedRepresentationString,
  Password,
  UnlockedSessionString,
} from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  loadVault: vi.fn(),
  password: vi.fn(),
}))
vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: vi.fn(),
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))
vi.mock('@inquirer/prompts', () => ({ password: mocks.password }))

import ImportTextCommand from '../src/commands/import/text.mjs'
import createVaultSaveFunction from '../src/utils/vaultSaveFunction.mjs'

const uri =
  'otpauth://totp/Example:Account?secret=JBSWY3DPEHPK3PXP&issuer=Example'
const vaultPassword =
  'a very strong and unusual test vault password' as Password
const exportPassword = 'a different and unusual export password'

describe('import text', () => {
  let emptyVault: LockedRepresentationString
  let session: UnlockedSessionString
  let encrypted: string
  let directory: string
  let vaultLocation: string
  let favaLib: FavaLib
  let stdout: string
  let stderr: string
  let interactive: boolean

  beforeAll(async () => {
    const utils = getFavaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
      (data) => {
        emptyVault = data
        return Promise.resolve()
      },
    )
    const { favaLib: lib } = await utils.createNewFavaLibVault(vaultPassword)
    await lib.storage.forceSave()
    const original = emptyVault
    session = lib.storage.exportUnlockedSession()
    await lib.exportImport.importFromTextFile(uri)
    encrypted = await lib.exportImport.exportEntries('text', exportPassword)
    emptyVault = original
  }, 30_000)

  beforeEach(async () => {
    vi.clearAllMocks()
    for (const name of [
      'FAVACLI_SYNC_SERVER_URL',
      'FAVACLI_SYNC_SERVER_SECRET',
      'FAVACLI_SYNC_SERVER_SECRET_FILE',
    ])
      vi.stubEnv(name, undefined)
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-import-'))
    vaultLocation = path.join(directory, 'vault.json')
    await fs.writeFile(vaultLocation, emptyVault)
    const utils = getFavaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
      createVaultSaveFunction(vaultLocation),
    )
    favaLib = await utils.loadFavaLibFromUnlockedSession(emptyVault, session, {
      connectToSyncServer: false,
    })
    await favaLib.ready
    mocks.init.mockResolvedValue({
      lockedRepresentationString: emptyVault,
      settings: {
        vaultLocation,
        syncIntervalMinutes: 5,
        lastSyncedAt: Date.now(),
      },
    })
    mocks.loadVault.mockResolvedValue(favaLib)
    stdout = ''
    stderr = ''
    interactive = false
  })

  afterEach(async () => {
    favaLib.sync?.closeServerConnection()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const run = async (contents: string, ...args: string[]) => {
    const file = path.join(directory, 'import.txt')
    await fs.writeFile(file, contents)
    const cli = new Cli()
    cli.register(ImportTextCommand)
    const command = cli.process(['import', 'text', '--path', file, ...args])
    command.context = {
      stdin: { isTTY: interactive },
      stdout: {
        write: (chunk: string) => {
          stdout += chunk
          return true
        },
      },
      stderr: {
        write: (chunk: string) => {
          stderr += chunk
          return true
        },
      },
    } as unknown as typeof command.context
    return command.execute()
  }

  it('persists valid entries, preserves file line numbers and reports partial failure in JSON', async () => {
    const code = await run(
      `\n# fava-export-version: 1\n\n${uri}\n  \ninvalid\n`,
      '--format',
      'json',
    )
    expect(code).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({
      result: {
        success: false,
        imported: 1,
        failed: 1,
        results: [
          { lineNr: 4, entryId: expect.any(String) as unknown, error: null },
          { lineNr: 6, entryId: null, error: expect.any(String) as unknown },
        ],
      },
    })
    expect(stderr).toBe('')
    expect(stdout).not.toContain('JBSWY3DPEHPK3PXP')
    const saved = (await fs.readFile(
      vaultLocation,
      'utf8',
    )) as LockedRepresentationString
    const utils = getFavaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
    )
    const reopened = await utils.loadFavaLibFromUnlockedSession(
      saved,
      session,
      { connectToSyncServer: false },
    )
    await reopened.ready
    expect(reopened.vault.listEntries()).toHaveLength(1)
    expect(await fs.readFile(`${vaultLocation}.backup`, 'utf8')).toBeTruthy()
    expect(mocks.loadVault).toHaveBeenCalledWith(
      emptyVault,
      expect.anything(),
      expect.any(Function),
      { connectToSyncServer: true, syncServer: undefined },
    )
  })

  it('imports password-protected exports with a masked prompt', async () => {
    interactive = true
    mocks.password.mockResolvedValue(exportPassword)
    expect(await run(`\uFEFF\n${encrypted}`)).toBe(0)
    expect(mocks.password).toHaveBeenCalledWith(
      { message: 'Export password:', mask: '*' },
      expect.anything(),
    )
    expect(favaLib.vault.listEntries()).toHaveLength(1)
    expect(stdout).not.toContain(exportPassword)
  })

  it('reads the password from a file without prompting and honors no-sync', async () => {
    const file = path.join(directory, 'password')
    await fs.writeFile(file, `${exportPassword}\r\n`)
    expect(await run(encrypted, '--password-file', file, '--no-sync')).toBe(0)
    expect(mocks.password).not.toHaveBeenCalled()
    expect(favaLib.vault.listEntries()).toHaveLength(1)
    expect(mocks.loadVault).toHaveBeenCalledWith(
      emptyVault,
      expect.anything(),
      expect.any(Function),
      { connectToSyncServer: false, syncServer: undefined },
    )
  })

  it('rejects a wrong password without changing entries or the saved vault', async () => {
    const file = path.join(directory, 'password')
    await fs.writeFile(file, 'wrong')
    await expect(run(encrypted, '--password-file', file)).rejects.toThrow(
      'Could not import',
    )
    expect(favaLib.vault.listEntries()).toHaveLength(0)
    expect(await fs.readFile(vaultLocation, 'utf8')).toBe(emptyVault)
  })

  it('does not trim spaces from password files', async () => {
    const file = path.join(directory, 'password')
    await fs.writeFile(file, ` ${exportPassword} \n`)
    await expect(run(encrypted, '--password-file', file)).rejects.toThrow(
      'Could not import',
    )
  })

  it('requires a password file without a terminal', async () => {
    await expect(run(encrypted)).rejects.toThrow('Use --password-file')
    expect(mocks.password).not.toHaveBeenCalled()
  })

  it('rejects empty and unreadable password files without prompting', async () => {
    const file = path.join(directory, 'password')
    await expect(run(encrypted, '--password-file', file)).rejects.toThrow(
      'Could not read the password file',
    )
    await fs.writeFile(file, '\n')
    await expect(run(encrypted, '--password-file', file)).rejects.toThrow(
      'must not be empty',
    )
    expect(mocks.password).not.toHaveBeenCalled()
  })

  it('rejects a password file for plaintext and unreadable import paths', async () => {
    await expect(run(uri, '--password-file', '/unused')).rejects.toThrow(
      'requires a password-encrypted',
    )
    await expect(
      run(uri, '--path', path.join(directory, 'missing')),
    ).rejects.toThrow('Could not read the import file')
    expect(favaLib.vault.listEntries()).toHaveLength(0)
  })

  it('accepts empty exports and appends repeated imports', async () => {
    expect(await run(' \r\n# fava-export-version: 1\n')).toBe(0)
    expect(stdout).toContain('Imported 0 entries; 0 lines failed')
    await run(uri)
    await run(uri)
    expect(favaLib.vault.listEntries()).toHaveLength(2)
  })

  it('reports human line failures and handles password prompt cancellation', async () => {
    expect(await run('invalid')).toBe(1)
    expect(stderr).toContain('Line 1: Invalid OTP URI')
    interactive = true
    mocks.password.mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'ExitPromptError' }),
    )
    expect(await run(encrypted)).toBe(130)
    expect(favaLib.vault.listEntries()).toHaveLength(0)
  })
})
