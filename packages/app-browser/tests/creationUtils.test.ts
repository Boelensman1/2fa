import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnsupportedStorageVersionError } from 'favalib'
import type { LockedRepresentationString, Password } from 'favalib'

vi.mock('../src/parameters', () => ({
  deviceType: 'web',
  passwordExtraDict: ['browser', 'web'],
  syncServerUrl: undefined,
}))

// Import the actual browser wiring rather than the library factory, so that
// what is under test is the save function this app really installs.
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

  it('refuses a v1 vault and does not rewrite it', async () => {
    // The correct password, so the refusal is the version gate and not a
    // failed unlock. Nothing may be written: a v1 blob dropped over a current
    // vault opening AND being rewritten in place is the downgrade window
    // key-hierarchy-review/18-anti-rollback.md is about.
    await expect(loadStoredVault(v1Password)).rejects.toThrow(
      UnsupportedStorageVersionError,
    )
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(v1Fixture)
  })

  it('leaves the stored vault untouched when the password is wrong', async () => {
    await expect(
      loadStoredVault('wrong-password' as Password),
    ).rejects.toThrow()
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(v1Fixture)
  })

  it('opens an existing v2 vault without rewriting it', async () => {
    localStorage.setItem(storageKey, v2Fixture)
    setItem.mockClear()

    const lib = await loadStoredVault(v2Password)
    await lib.ready

    // The v2 fixture's device id; it changed when storage version 2 was
    // redefined to the curve hierarchy and the fixture was regenerated. See
    // packages/lib/tests/fixtures/README.md.
    //
    // Nothing is written on a successful load either: the load path has no
    // reason to save, now that there is no migration to persist.
    expect(lib.meta.deviceId).toBe('822d43ef-ab39-4a9e-a106-2e96eb3fdb82')
    expect(lib.vault.listEntriesMetas()).toHaveLength(2)
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBe(v2Fixture)
  })
})
