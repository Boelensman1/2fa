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
}))
vi.mock('../src/utils/init.mjs', () => ({
  default: mocks.init,
  saveSettings: vi.fn(),
}))
vi.mock('../src/utils/loadVault.mjs', () => ({ default: mocks.loadVault }))

import EntriesAddCommand from '../src/commands/entries/add.mjs'
import createVaultSaveFunction from '../src/utils/vaultSaveFunction.mjs'

const vaultPassword =
  'a very strong and unusual test vault password' as Password

describe('entries add', () => {
  let emptyVault: LockedRepresentationString
  let session: UnlockedSessionString
  let directory: string
  let favaLib: FavaLib
  let stdout: string

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
    session = lib.storage.exportUnlockedSession()
  }, 30_000)

  beforeEach(async () => {
    vi.clearAllMocks()
    for (const name of [
      'FAVACLI_SYNC_SERVER_URL',
      'FAVACLI_SYNC_SERVER_SECRET',
      'FAVACLI_SYNC_SERVER_SECRET_FILE',
    ])
      vi.stubEnv(name, undefined)
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'favacli-add-'))
    const vaultLocation = path.join(directory, 'vault.json')
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
  })

  afterEach(async () => {
    favaLib.sync?.closeServerConnection()
    vi.unstubAllEnvs()
    await fs.rm(directory, { recursive: true, force: true })
  })

  const run = async (...args: string[]) => {
    const cli = new Cli()
    cli.register(EntriesAddCommand)
    const command = cli.process([
      'entries',
      'add',
      '--name',
      'Account',
      '--issuer',
      'Example',
      '--secret',
      'JBSWY3DPEHPK3PXP',
      '--no-sync',
      ...args,
    ])
    command.context = {
      stdin: { isTTY: false },
      stdout: {
        write: (chunk: string) => {
          stdout += chunk
          return true
        },
      },
      stderr: { write: () => true },
    } as unknown as typeof command.context
    return command.execute()
  }

  const storedAlgorithm = async () => {
    const [uri] = (
      await favaLib.exportImport.exportEntries('text', undefined, true)
    )
      .split('\n')
      .filter((line) => line.startsWith('otpauth://'))
    return new URL(uri).searchParams.get('algorithm')
  }

  it.each([
    [[], 'SHA1'],
    [['--algorithm', 'SHA-256'], 'SHA256'],
    [['--algorithm', 'SHA256'], 'SHA256'],
    [['--algorithm', 'sha512'], 'SHA512'],
  ])('adds an entry with %j', async (args, expected) => {
    expect(await run(...args)).toBe(0)
    expect(stdout).toContain('Entry added!')
    const [entryId] = favaLib.vault.listEntries()
    expect(
      (await favaLib.vault.generateTokenForEntry(entryId)).otp,
    ).toHaveLength(6)
    expect(await storedAlgorithm()).toBe(expected)
  })

  it('rejects an unsupported algorithm without adding the entry', async () => {
    await expect(run('--algorithm', 'MD5')).rejects.toThrow(
      'Invalid --algorithm "MD5"',
    )
    expect(favaLib.vault.listEntries()).toHaveLength(0)
  })
})
