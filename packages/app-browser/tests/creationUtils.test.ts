import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  EntryId,
  LockedRepresentation,
  LockedRepresentationString,
  Password,
} from 'favalib'

vi.mock('../src/parameters', () => ({
  deviceType: 'web',
  passwordExtraDict: ['browser', 'web'],
  syncServerUrl: undefined,
}))

// Import the actual browser wiring: using the library factory directly would
// miss a placeholder save callback that throws during the v1 migration.
import creationUtils from '../src/utils/creationUtils'

const v1Fixture = readFileSync(
  new URL('../../lib/tests/fixtures/vault-v1.json', import.meta.url),
  'utf8',
)
const v2Fixture = readFileSync(
  new URL('../../lib/tests/fixtures/vault-v2.json', import.meta.url),
  'utf8',
)
const v1Password = 'fixture!Vault7#Frozen$v1' as Password
const v2Password = 'fixture!Vault7#Frozen$v2' as Password
const storageKey = 'lockedRepresentation'

describe('browser vault loading', () => {
  const setItem = vi.fn<(key: string, value: string) => void>()

  beforeEach(() => {
    const values = new Map([[storageKey, v1Fixture]])
    setItem.mockReset().mockImplementation((key, value) => {
      values.set(key, value)
    })
    vi.stubGlobal('window', { crypto: webcrypto })
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const loadStoredVault = (password: Password) =>
    creationUtils.loadFavaLibFromLockedRepesentation(
      localStorage.getItem(storageKey) as LockedRepresentationString,
      password,
      { connectToSyncServer: false },
    )

  it('persists the v1 migration before loading returns and reopens it', async () => {
    const lib = await loadStoredVault(v1Password)
    // Assert immediately, before Login could install its UI-aware callback.
    const migrated = JSON.parse(
      localStorage.getItem(storageKey)!,
    ) as LockedRepresentation
    expect(migrated.storageVersion).toBe(2)
    expect(migrated.envelopeMac).toEqual(expect.any(String))
    await lib.ready

    const reopened = await loadStoredVault(v1Password)
    await reopened.ready

    for (const vault of [lib, reopened]) {
      expect(vault.meta.deviceId).toBe('91b8a8bf-3450-4e68-94db-4d6051901ffa')
      expect(vault.vault.listEntriesMetas()).toHaveLength(2)
      // Expected OTPs are independently pinned by the frozen fixture suite.
      for (const [id, name, otp] of [
        ['e6c4f652-bf77-4ca4-be3a-8b06dc63dd21', 'Fixture Entry One', '324550'],
        ['01d91809-ae5d-4385-ad26-bee175020361', 'Fixture Entry Two', '017492'],
      ]) {
        expect(vault.vault.getEntryMeta(id as EntryId).name).toBe(name)
        expect(
          await vault.vault.generateTokenForEntry(
            id as EntryId,
            1_700_000_000_000,
          ),
        ).toMatchObject({ otp })
      }
    }
  })

  it('leaves the stored vault untouched when the password is wrong', async () => {
    await expect(
      loadStoredVault('wrong-password' as Password),
    ).rejects.toThrow()
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(v1Fixture)
  })

  it('propagates a migration save failure and keeps the original vault', async () => {
    const storageError = new DOMException(
      'Storage is full',
      'QuotaExceededError',
    )
    setItem.mockImplementation(() => {
      throw storageError
    })

    await expect(loadStoredVault(v1Password)).rejects.toBe(storageError)
    expect(localStorage.getItem(storageKey)).toBe(v1Fixture)
  })

  it('opens an existing v2 vault without rewriting it', async () => {
    localStorage.setItem(storageKey, v2Fixture)
    setItem.mockClear()

    const lib = await loadStoredVault(v2Password)
    await lib.ready

    expect(lib.meta.deviceId).toBe('9ad6d991-a1b0-45a2-8e3f-01de0a956272')
    expect(lib.vault.listEntriesMetas()).toHaveLength(2)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(v2Fixture)
  })
})
