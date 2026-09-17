import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  type Mock,
} from 'vitest'
import { base64ToUint8Array } from 'uint8array-extras'
import {
  getFavaLibVaultCreationUtils,
  FavaLib,
  type LockedRepresentationString,
  type Password,
  type Salt,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  STORAGE_VERSION,
  type KdfParameters,
  type SymmetricKey,
  FavaLibEvent,
} from '../../src/main.mjs'
import { buildVaultAad } from '../../src/utils/canonical.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import {
  clearEntries,
  createFavaLibForTests,
  deviceType,
} from '../testUtils.mjs'
import { newTotpEntry } from '../testUtils.mjs'
import type PersistentStorageManager from '../../src/subclasses/PersistentStorageManager.mjs'
import type {
  LockedRepresentation,
  UnlockedSession,
  VaultState,
} from '../../src/interfaces/Vault.mjs'
import type SyncManager from '../../src/subclasses/SyncManager.mjs'

const getNthMockCallFirstArg = (mockFn: Mock, n: number) => {
  return mockFn.mock.calls[n][0] as string
}

describe('PersistentStorageManager', () => {
  let favaLib: FavaLib
  let persistentStorageManager: PersistentStorageManager
  let password: Password
  let salt: Salt
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let symmetricKey: SymmetricKey
  let kdf: KdfParameters

  beforeAll(async () => {
    const result = await createFavaLibForTests()
    favaLib = result.favaLib
    password = result.password
    salt = result.salt
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    symmetricKey = result.symmetricKey
    kdf = result.kdf

    // eslint-disable-next-line @typescript-eslint/dot-notation
    persistentStorageManager = favaLib['persistentStorageManager']
  })

  beforeEach(async () => {
    await clearEntries(favaLib)
  })

  it('should return a locked representation', async () => {
    await favaLib.vault.addEntry(newTotpEntry)

    // Get the internal cryptoLib instance used by persistentStorageManager
    // @ts-expect-error: Using private property for testing
    const internalCryptoLib = persistentStorageManager.cryptoLib

    // A spy, not a stub: vitest's spyOn calls through, so everything below is
    // asserted against the real ciphertext. This used to be mocked to the
    // identity function, which left the stored encoding asserted nowhere --
    // see key-hierarchy-review/06-crypto-test-coverage.md.
    const encryptSymmetricSpy = vi.spyOn(internalCryptoLib, 'encryptSymmetric')

    // @ts-expect-error: Using private property for testing
    const mediator = persistentStorageManager.mediator
    const mockedSyncManager = {
      syncDevices: 'syncDevicesFromMock',
      serverUrl: 'serverUrlFromMock',
      getCommandSendQueue: () => 'syncCommandSendQueueFromMock',
    } as unknown as SyncManager
    mediator.registerComponent('syncManager', mockedSyncManager)

    const locked = await persistentStorageManager.getLockedRepresentation()

    expect(encryptSymmetricSpy).toHaveBeenCalledOnce()

    // should be json
    expect(locked).toMatch(/^{/)

    const parsed = JSON.parse(locked) as LockedRepresentation

    expect(parsed).toEqual({
      libVersion: FavaLib.version,
      storageVersion: STORAGE_VERSION,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      kdf,
      envelopeMac: expect.any(String) as string,
      encryptedVaultState: expect.any(String) as string,
    })

    // The stored envelope is "v2" + ":" + base64(nonce) + ":" +
    // base64(ciphertext || tag): a 12-byte GCM nonce, and a payload that is
    // the plaintext length plus the 16-byte tag. GCM is a stream cipher, so
    // unlike the v1 CBC envelope the ciphertext is NOT a multiple of 16.
    const envelope = parsed.encryptedVaultState.split(':')
    expect(envelope).toHaveLength(3)
    const [prefix, nonce, cipherText] = envelope
    expect(prefix).toBe('v2')
    expect(base64ToUint8Array(nonce)).toHaveLength(12)
    const cipherBytes = base64ToUint8Array(cipherText)
    expect(cipherBytes.length).toBeGreaterThan(16)

    // And it decrypts, with the vault's own symmetric key AND the at-rest
    // AAD, back to the state. Rebuilding the AAD here rather than reading it
    // from the library is the point: if the two ever disagree, this fails.
    const cryptoLib = new nodeProviders.CryptoLib()
    const aad = buildVaultAad(
      STORAGE_VERSION,
      salt,
      kdf,
      await cryptoLib.sha256(encryptedPrivateKey),
    )
    expect(cipherBytes.length).toBe(
      new TextEncoder().encode(
        await cryptoLib.decryptSymmetric(
          symmetricKey,
          parsed.encryptedVaultState,
          aad,
        ),
      ).length + 16,
    )
    const vaultStateString = await cryptoLib.decryptSymmetric(
      symmetricKey,
      parsed.encryptedVaultState,
      aad,
    )
    expect(vaultStateString).toMatch(/^{/)
    const parsedVaultState = JSON.parse(vaultStateString) as VaultState
    expect(parsedVaultState).toEqual({
      deviceId: favaLib.meta.deviceId,
      sync: {
        devices: 'syncDevicesFromMock',
        serverUrl: 'serverUrlFromMock',
        commandSendQueue: 'syncCommandSendQueueFromMock',
      },
      vault: [
        {
          id: expect.any(String) as string,
          name: 'Test TOTP',
          issuer: 'Test Issuer',
          type: 'TOTP',
          matchers: [],
          url: null,
          inputSelector: null,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
          payload: {
            secret: 'TESTSECRET',
            period: 30,
            algorithm: 'SHA-1',
            digits: 6,
          },
        },
      ],
    })

    encryptSymmetricSpy.mockRestore()
    mediator.unRegisterComponent('syncManager')
  })

  it('Should save when save is called', async () => {
    const mockSaveFunction = vi.fn()
    favaLib.storage.setSaveFunction(mockSaveFunction)
    await persistentStorageManager.save()
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)
  })

  it('Should save when data is changed', async () => {
    const mockSaveFunction = vi.fn()
    favaLib.storage.setSaveFunction(mockSaveFunction)

    // Add an entry
    await favaLib.vault.addEntry(newTotpEntry)

    // Check if save function was called again
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    // Check if the save function was called with the correct argument
    const firstCall = getNthMockCallFirstArg(mockSaveFunction, 0)
    expect(firstCall).toEqual(expect.any(String) as string)
    expect(() => {
      JSON.parse(firstCall)
    }).not.toThrow()

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = favaLib.vault.listEntries()
    await favaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    const secondCall = getNthMockCallFirstArg(mockSaveFunction, 0)
    expect(secondCall).toEqual(expect.any(String))
    expect(() => {
      JSON.parse(secondCall)
    }).not.toThrow()

    expect(firstCall).not.toEqual(secondCall)
  }, 15000) // long running test

  /**
   * A vault of this test's own, with a save function that keeps the blobs it
   * was handed.
   *
   * The shared favaLib cannot be used for anything that changes the password:
   * a change now rotates the salt, and the module-scope `salt` captured in
   * beforeAll is what the rest of this file validates against. Its own vault
   * also removes the need for the change-it-back call these tests used to end
   * with.
   * @returns The vault, its manager, and the saved representations.
   */
  const createRotatableVault = async () => {
    const result = await createFavaLibForTests()
    const saved: LockedRepresentationString[] = []
    const saveFunction = vi.fn((data: LockedRepresentationString) => {
      saved.push(data)
    })
    // eslint-disable-next-line @typescript-eslint/dot-notation
    const psm = result.favaLib['persistentStorageManager']
    psm.setSaveFunction(saveFunction)

    return {
      ...result,
      psm,
      saveFunction,
      /**
       * @returns The most recently saved locked representation, parsed.
       */
      lastSaved: () => {
        const last = saved.at(-1)
        if (!last) {
          // eslint-disable-next-line no-restricted-globals
          throw new Error('No saved data')
        }
        return JSON.parse(last) as LockedRepresentation
      },
      /**
       * @returns The most recently saved locked representation, as stored.
       */
      lastSavedString: () => {
        const last = saved.at(-1)
        if (!last) {
          // eslint-disable-next-line no-restricted-globals
          throw new Error('No saved data')
        }
        return last
      },
    }
  }

  const newPassword = '8ySml!DK6QxJP6e6l$Cf' as Password

  it('rotates the salt and the symmetric key on a password change', async () => {
    const vault = await createRotatableVault()
    const oldSalt = vault.salt
    const oldSymmetricKey = vault.symmetricKey
    await vault.favaLib.vault.addEntry(newTotpEntry)

    await vault.psm.changePassword(password, newPassword)

    const after = vault.lastSaved()
    const cryptoLib = new nodeProviders.CryptoLib()

    // 1. The salt moved, and is still 16 bytes of base64.
    expect(after.salt).not.toBe(oldSalt)
    expect(base64ToUint8Array(after.salt)).toHaveLength(16)

    // 2. So did the symmetric key. Compare the KEY, not its wrap: RSA-OAEP is
    // randomised, so encryptedSymmetricKey differs on every re-wrap whether or
    // not anything rotated, and asserting on it would pass against the old
    // no-rotation behaviour too.
    const { symmetricKey: newSymmetricKey } = await cryptoLib.decryptKeys(
      after.encryptedPrivateKey,
      after.encryptedSymmetricKey,
      after.salt,
      newPassword,
      after.kdf,
    )
    expect(newSymmetricKey).not.toBe(oldSymmetricKey)

    const afterAad = buildVaultAad(
      STORAGE_VERSION,
      after.salt,
      after.kdf,
      await cryptoLib.sha256(after.encryptedPrivateKey),
    )

    // 3. The whole point of the finding: whoever kept the old key cannot read
    // what the vault writes after the change. (The ciphertexts written BEFORE
    // it are of course still readable under it -- a ciphertext cannot be
    // unmade. Rotation closes future writes, and nothing else can.)
    await expect(
      cryptoLib.decryptSymmetric(
        oldSymmetricKey,
        after.encryptedVaultState,
        afterAad,
      ),
    ).rejects.toThrow('Could not decrypt data')

    // ...and the positive control, in the same test: the new key does open it,
    // and what comes out is this vault, not merely something well-formed.
    const vaultState = JSON.parse(
      await cryptoLib.decryptSymmetric(
        newSymmetricKey,
        after.encryptedVaultState,
        afterAad,
      ),
    ) as VaultState
    expect(vaultState.vault).toHaveLength(1)
    expect(vaultState.vault[0].name).toBe('Test TOTP')

    // 4. The AAD moved with the salt. Catches a swap that rotated the key but
    // built the AAD from the stale salt -- which MACs correctly and would
    // otherwise only surface as an unopenable vault on someone's disk.
    await expect(
      cryptoLib.decryptSymmetric(
        newSymmetricKey,
        after.encryptedVaultState,
        buildVaultAad(
          STORAGE_VERSION,
          oldSalt,
          after.kdf,
          await cryptoLib.sha256(after.encryptedPrivateKey),
        ),
      ),
    ).rejects.toThrow('Could not decrypt data')
  }, 30000) // long running test

  it('reopens under the new password only', async () => {
    const vault = await createRotatableVault()
    await vault.favaLib.vault.addEntry(newTotpEntry)

    await vault.psm.changePassword(password, newPassword)
    const after = vault.lastSaved()

    // The half-swap canary: any disagreement among the six rotated values --
    // MAC key against salt, AAD against salt, ciphertext against wrapped key
    // -- fails right here rather than on a user's next unlock.
    const { loadFavaLibFromLockedRepesentation } = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      ['test'],
    )
    const newFavaLib = await loadFavaLibFromLockedRepesentation(
      vault.lastSavedString(),
      newPassword,
    )
    expect(newFavaLib.vault.listEntriesMetas()).toHaveLength(1)

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const newPersistentStorageManager = newFavaLib['persistentStorageManager']

    await expect(
      newPersistentStorageManager.validatePassword(after.salt, newPassword),
    ).resolves.toBe(true)
    await expect(
      newPersistentStorageManager.validatePassword(after.salt, password),
    ).resolves.toBe(false)
  }, 30000) // long running test

  it('emits PasswordChanged once the new material is saved', async () => {
    const vault = await createRotatableVault()
    const listener = vi.fn()
    let saltWhenFired: string | undefined
    vault.favaLib.addEventListener(FavaLibEvent.PasswordChanged, () => {
      listener()
      saltWhenFired = vault.lastSaved().salt
    })

    await vault.psm.changePassword(password, newPassword)

    expect(listener).toHaveBeenCalledOnce()
    // Fired after the save, not before: a listener dropping a cached password
    // must never be able to act on a change that has not reached storage.
    expect(saltWhenFired).toBe(vault.lastSaved().salt)
    expect(saltWhenFired).not.toBe(vault.salt)
  }, 30000) // long running test

  it('puts the old key material back when the save fails', async () => {
    const vault = await createRotatableVault()
    const oldSalt = vault.salt

    vault.psm.setSaveFunction(() => {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('disk full')
    })
    await expect(
      vault.psm.changePassword(password, newPassword),
    ).rejects.toThrow('disk full')

    // The caller saw a rejection, so the user was told their password is
    // unchanged. The instance has to agree with that, or the next autosave
    // commits a password nobody was ever given -- a lockout with no recovery
    // path, since the old encryptedPrivateKey is gone.
    vault.psm.setSaveFunction(vault.saveFunction)
    await vault.favaLib.storage.forceSave()

    const after = vault.lastSaved()
    expect(after.salt).toBe(oldSalt)

    const { loadFavaLibFromLockedRepesentation } = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      ['test'],
    )
    await expect(
      loadFavaLibFromLockedRepesentation(vault.lastSavedString(), password),
    ).resolves.toBeInstanceOf(FavaLib)
  }, 30000) // long running test

  it('leaves the key material untouched when the old password is wrong', async () => {
    const vault = await createRotatableVault()
    const oldSalt = vault.salt

    await expect(
      vault.psm.changePassword('wrongpassword!' as Password, newPassword),
    ).rejects.toThrow('Invalid old password')

    await vault.favaLib.storage.forceSave()
    expect(vault.lastSaved().salt).toBe(oldSalt)
    await expect(vault.psm.validatePassword(oldSalt, password)).resolves.toBe(
      true,
    )
  }, 30000) // long running test

  it('draws a different salt on every change', async () => {
    const vault = await createRotatableVault()
    const secondPassword = 'Qx7#pL2m!Vn4$Rt8' as Password

    await vault.psm.changePassword(password, newPassword)
    const firstSalt = vault.lastSaved().salt
    await vault.psm.changePassword(newPassword, secondPassword)
    const secondSalt = vault.lastSaved().salt

    expect(new Set([vault.salt, firstSalt, secondSalt]).size).toBe(3)
  }, 45000) // long running test

  it('exports an unlocked session that tracks the live key generation', async () => {
    // Pins that exportUnlockedSession reads the manager's mutable state rather
    // than a copy taken at construction: the two rotated secrets must move and
    // the two retained ones must not. See
    // key-hierarchy-review/07-session-key-api.md.
    const vault = await createRotatableVault()

    const before = JSON.parse(
      vault.psm.exportUnlockedSession(),
    ) as UnlockedSession
    await vault.psm.changePassword(password, newPassword)
    const after = JSON.parse(
      vault.psm.exportUnlockedSession(),
    ) as UnlockedSession

    expect(after.symmetricKey).not.toBe(before.symmetricKey)
    expect(after.macKey).not.toBe(before.macKey)
    // Deliberately NOT rotated -- peers hold this device's public key
    // (04-key-rotation.md).
    expect(after.privateKey).toBe(before.privateKey)
    expect(after.publicKey).toBe(before.publicKey)
  }, 45000) // long running test

  it('should throw an error when changing to a weak password', async () => {
    const oldPassword = password
    const weakPassword = 'test123' as Password

    await expect(
      persistentStorageManager.changePassword(oldPassword, weakPassword),
    ).rejects.toThrow('Password is too weak')

    // Verify that the old password still works
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      oldPassword,
    )
    expect(isValid).toBe(true)
  })

  it('should validate correct password', async () => {
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      password,
    )
    expect(isValid).toBe(true)
  })

  it('should invalidate incorrect password', async () => {
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      'wrongpassword!' as Password,
    )
    expect(isValid).toBe(false)
  })

  it('should not allow two save functions to run concurrently', async () => {
    let saveCallCount = 0
    let activeSaveCalls = 0
    let maxConcurrentSaves = 0

    const mockSaveFunction = vi.fn(async (data: LockedRepresentationString) => {
      saveCallCount++
      activeSaveCalls++
      maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaveCalls)

      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 100))

      activeSaveCalls--

      expect(data).toBeTypeOf('string')
    })

    favaLib.storage.setSaveFunction(mockSaveFunction)

    // Trigger multiple save operations simultaneously
    const promises = [
      favaLib.storage.forceSave(),
      favaLib.storage.forceSave(),
      favaLib.storage.forceSave(),
    ]

    await Promise.all(promises)

    // Verify that save was called for each operation
    expect(mockSaveFunction).toHaveBeenCalledTimes(3)
    expect(saveCallCount).toBe(3)

    // Verify that saves were queued/serialized, not run concurrently
    expect(maxConcurrentSaves).toBe(1)
  }, 15000) // long running test
})
