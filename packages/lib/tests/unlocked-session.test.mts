import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll, vi } from 'vitest'

import {
  CryptoError,
  FavaLibEvent,
  InitializationError,
  SESSION_VERSION,
  StorageVersionError,
  getFavaLibVaultCreationUtils,
  type DeviceType,
  type EntryId,
  type LockedRepresentation,
  type LockedRepresentationString,
  type Password,
  type UnlockedSession,
  type UnlockedSessionString,
} from '../src/main.mjs'
import type CryptoLib from '../src/interfaces/CryptoLib.mjs'
import type { PlatformProviders } from '../src/interfaces/PlatformProviders.mjs'
import type { PasswordExtraDict } from '../src/interfaces/PasswordExtraDict.js'
import { nodeProviders } from '../src/platformProviders/node/index.mjs'
import { browserProviders } from '../src/platformProviders/browser/index.mjs'
import { createFavaLibForTests, newTotpEntry } from './testUtils.mjs'

// The browser CryptoLib reads window.crypto inside its method bodies only, so
// this shim cannot perturb the node half of this file. Same trick as
// fixtures.test.mts and CryptoProviders/compare-node-browser.
// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

// The frozen v2 fixture. See tests/fixtures/README.md -- never regenerated,
// and opened here with no saveFunction so a test run cannot rewrite it.
const V2_FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v2' as Password
const V2_FIXTURE_DEVICE_ID = '9ad6d991-a1b0-45a2-8e3f-01de0a956272'
const V2_ENTRY_ONE = {
  id: '9898f013-9e8c-412b-b892-a5eb8a583851' as EntryId,
  // Cross-checked against an independent RFC 6238 implementation.
  otpAtFixedTimestamp: '324550',
}
const V2_ENTRY_TWO = {
  id: '09e3a359-3764-4a73-ba55-bc5ce2fec2d5' as EntryId,
  otpAtFixedTimestamp: '017492',
}
const FIXED_TIMESTAMP = 1_700_000_000_000

const fixtureV2 = readFileSync(
  new URL('./fixtures/vault-v2.json', import.meta.url),
  'utf8',
) as LockedRepresentationString
const fixtureV1 = readFileSync(
  new URL('./fixtures/vault-v1.json', import.meta.url),
  'utf8',
) as LockedRepresentationString
const V1_FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v1' as Password

const fixtureDeviceType = 'fixture-device' as DeviceType
const fixtureExtraDict: PasswordExtraDict = ['fixture']

const utils = (providers: PlatformProviders = nodeProviders) =>
  getFavaLibVaultCreationUtils(providers, fixtureDeviceType, fixtureExtraDict)

/**
 * A node provider whose CryptoLib counts every argon2id entry point.
 *
 * A counting provider rather than vi.spyOn, because the CryptoLib instance a
 * load path uses is created inside getFavaLibVaultCreationUtils's own
 * LibraryLoader and is not reachable from the bundle it returns --
 * favaLib['persistentStorageManager']['cryptoLib'] is a different instance
 * belonging to a different LibraryLoader, so spying there would assert nothing
 * about the load. The counter is closure-scoped, so it counts across every
 * LibraryLoader a test creates.
 *
 * createSyncKey is deliberately absent: it also runs argon2id, but it is not
 * reachable from a vault load.
 * @returns The providers to hand to getFavaLibVaultCreationUtils, and a reader
 * for the number of derivations so far.
 */
const countingProviders = (): {
  providers: PlatformProviders
  count: () => number
} => {
  let calls = 0
  class CountingCryptoLib extends nodeProviders.CryptoLib {
    createKeys: CryptoLib['createKeys'] = (password) => {
      calls++
      return super.createKeys(password)
    }
    decryptKeys: CryptoLib['decryptKeys'] = (
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      password,
      kdf,
    ) => {
      calls++
      return super.decryptKeys(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        password,
        kdf,
      )
    }
    decryptKeysV1: CryptoLib['decryptKeysV1'] = (
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      password,
    ) => {
      calls++
      return super.decryptKeysV1(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        password,
      )
    }
    encryptKeys: CryptoLib['encryptKeys'] = (
      privateKey,
      symmetricKey,
      salt,
      password,
      kdf,
    ) => {
      calls++
      return super.encryptKeys(privateKey, symmetricKey, salt, password, kdf)
    }
  }
  return {
    providers: { ...nodeProviders, CryptoLib: CountingCryptoLib },
    count: () => calls,
  }
}

describe('unlocked session (07-session-key-api.md)', () => {
  describe('round trip, on the frozen v2 fixture', () => {
    let session: UnlockedSessionString

    beforeAll(async () => {
      const lib = await utils().loadFavaLibFromLockedRepesentation(
        fixtureV2,
        V2_FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      session = lib.storage.exportUnlockedSession()
      lib.sync?.closeServerConnection()
    })

    it('reopens the vault with no password', async () => {
      const lib = await utils().loadFavaLibFromUnlockedSession(
        fixtureV2,
        session,
        { connectToSyncServer: false },
      )

      expect(lib.meta.deviceId).toBe(V2_FIXTURE_DEVICE_ID)
      expect(lib.vault.size).toBe(2)
      lib.sync?.closeServerConnection()
    })

    it('produces the same OTPs the password path produces', async () => {
      const lib = await utils().loadFavaLibFromUnlockedSession(
        fixtureV2,
        session,
        { connectToSyncServer: false },
      )

      vi.setSystemTime(FIXED_TIMESTAMP)
      expect((await lib.vault.generateTokenForEntry(V2_ENTRY_ONE.id)).otp).toBe(
        V2_ENTRY_ONE.otpAtFixedTimestamp,
      )
      expect((await lib.vault.generateTokenForEntry(V2_ENTRY_TWO.id)).otp).toBe(
        V2_ENTRY_TWO.otpAtFixedTimestamp,
      )
      vi.useRealTimers()
      lib.sync?.closeServerConnection()
    })

    it('is reusable: one session survives many rehydrations', async () => {
      // The blob is not single use. An mv3 worker is evicted repeatedly, which
      // is the entire reason this api exists.
      for (let i = 0; i < 2; i++) {
        const lib = await utils().loadFavaLibFromUnlockedSession(
          fixtureV2,
          session,
          { connectToSyncServer: false },
        )
        expect(lib.vault.size).toBe(2)
        lib.sync?.closeServerConnection()
      }
    })

    it('imports under a different provider than it was exported from', async () => {
      // The blob carries a private key PEM, and node writes "\n" where
      // node-forge writes "\r\n". That asymmetry is what made the at-rest AAD
      // hash the exact stored bytes (02-ciphertext-authenticity.md); it is
      // cheap to close here too.
      const lib = await utils(browserProviders).loadFavaLibFromUnlockedSession(
        fixtureV2,
        session,
        { connectToSyncServer: false },
      )
      expect(lib.vault.size).toBe(2)
      lib.sync?.closeServerConnection()
    })

    it('runs no argon2id, which is what retires the objection in 01', async () => {
      const counting = countingProviders()
      const bundle = getFavaLibVaultCreationUtils(
        counting.providers,
        fixtureDeviceType,
        fixtureExtraDict,
      )

      // Positive control first: without it a counter wired to nothing would
      // pass the real assertion below.
      const viaPassword = await bundle.loadFavaLibFromLockedRepesentation(
        fixtureV2,
        V2_FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      expect(counting.count()).toBe(1)
      const freshSession = viaPassword.storage.exportUnlockedSession()
      viaPassword.sync?.closeServerConnection()

      const viaSession = await bundle.loadFavaLibFromUnlockedSession(
        fixtureV2,
        freshSession,
        { connectToSyncServer: false },
      )
      expect(counting.count()).toBe(1)
      viaSession.sync?.closeServerConnection()
    })

    it('does not save, and does not report a storage upgrade', async () => {
      // The contrast case is the v1 migration, which does both.
      const saveFunction = vi.fn()
      const logs: string[] = []
      const lib = await getFavaLibVaultCreationUtils(
        nodeProviders,
        fixtureDeviceType,
        fixtureExtraDict,
        saveFunction,
      ).loadFavaLibFromUnlockedSession(fixtureV2, session, {
        connectToSyncServer: false,
      })
      lib.addEventListener(FavaLibEvent.Log, (event) => {
        logs.push(event.detail.message)
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(saveFunction).not.toHaveBeenCalled()
      expect(logs.join('\n')).not.toMatch(/storage version/i)
      lib.sync?.closeServerConnection()
    })
  })

  describe('the exported blob', () => {
    it('carries only the four derived secrets', async () => {
      const { favaLib, salt, encryptedPrivateKey, password } =
        await createFavaLibForTests()

      const blob = favaLib.storage.exportUnlockedSession()
      const parsed = JSON.parse(blob) as UnlockedSession

      expect(Object.keys(parsed).sort()).toEqual([
        'macKey',
        'privateKey',
        'publicKey',
        'sessionVersion',
        'symmetricKey',
      ])
      // Nothing the stored vault already holds is duplicated into it, so the
      // two can never disagree -- and nothing upstream of argon2id is in it,
      // which is the whole finding.
      expect(blob).not.toContain(salt)
      expect(blob).not.toContain(encryptedPrivateKey)
      expect(blob).not.toContain(password)
      expect(parsed.sessionVersion).toBe(SESSION_VERSION)
    })
  })

  describe('staleness (04-key-rotation.md)', () => {
    /**
     * Builds a vault whose saved representation is observable.
     * @returns The instance, its password and a reader for the last save.
     */
    const createSavingVault = async () => {
      let saved: LockedRepresentationString
      const result = await createFavaLibForTests((representation) => {
        saved = representation
      })
      await result.favaLib.storage.forceSave()
      return { ...result, lastSaved: () => saved }
    }

    it('refuses a session exported before a password change', async () => {
      const { favaLib, password, lastSaved } = await createSavingVault()
      const stale = favaLib.storage.exportUnlockedSession()

      await favaLib.storage.changePassword(
        password,
        'aN0ther!Str0ng#Passw0rd' as Password,
      )

      await expect(
        utils().loadFavaLibFromUnlockedSession(lastSaved(), stale, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(CryptoError)
    }, 30000)

    it('accepts a session exported after that change', async () => {
      // The positive control for the test above, so it cannot pass for the
      // wrong reason.
      const { favaLib, password, lastSaved } = await createSavingVault()

      await favaLib.storage.changePassword(
        password,
        'aN0ther!Str0ng#Passw0rd' as Password,
      )
      const fresh = favaLib.storage.exportUnlockedSession()

      const lib = await utils().loadFavaLibFromUnlockedSession(
        lastSaved(),
        fresh,
        { connectToSyncServer: false },
      )
      expect(lib.meta.deviceId).toBe(favaLib.meta.deviceId)
      lib.sync?.closeServerConnection()
    }, 30000)

    it('accepts a session across saves made by the same generation', async () => {
      // The binding is to a key GENERATION, not to a particular blob. Without
      // this a consumer would re-export on every save, writing key material to
      // storage on every change.
      const { favaLib, lastSaved } = await createSavingVault()
      const session = favaLib.storage.exportUnlockedSession()

      await favaLib.vault.addEntry(newTotpEntry)
      await favaLib.storage.forceSave()

      const lib = await utils().loadFavaLibFromUnlockedSession(
        lastSaved(),
        session,
        { connectToSyncServer: false },
      )
      expect(lib.vault.size).toBe(favaLib.vault.size)
      lib.sync?.closeServerConnection()
    }, 30000)

    it('refuses a session belonging to a different vault', async () => {
      const a = await createSavingVault()
      const b = await createSavingVault()

      await expect(
        utils().loadFavaLibFromUnlockedSession(
          a.lastSaved(),
          b.favaLib.storage.exportUnlockedSession(),
          { connectToSyncServer: false },
        ),
      ).rejects.toThrow(CryptoError)
      await expect(
        utils().loadFavaLibFromUnlockedSession(
          b.lastSaved(),
          a.favaLib.storage.exportUnlockedSession(),
          { connectToSyncServer: false },
        ),
      ).rejects.toThrow(CryptoError)
    }, 45000)
  })

  describe('the stored vault is gated exactly as it is on the password path', () => {
    let session: UnlockedSessionString

    beforeAll(async () => {
      const { favaLib } = await createFavaLibForTests()
      session = favaLib.storage.exportUnlockedSession()
    })

    it('refuses a storage version 1 vault, before it looks at the session', async () => {
      // Deliberately paired with a syntactically invalid session: the version
      // gate has to win, or the caller of a future format is told their vault
      // is corrupt rather than that they should upgrade.
      await expect(
        utils().loadFavaLibFromUnlockedSession(
          fixtureV1,
          'not json at all' as UnlockedSessionString,
          { connectToSyncServer: false },
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it('refuses a v1 vault whose migration could not be persisted', async () => {
      // The subtle case. Loading the v1 fixture with no saveFunction leaves an
      // instance holding freshly re-wrapped v2 material while the store is
      // still v1, so its session looks perfectly valid -- and must still be
      // refused by the version gate rather than by a MAC failure.
      const migrated = await utils().loadFavaLibFromLockedRepesentation(
        fixtureV1,
        V1_FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      const sessionFromMigrated = migrated.storage.exportUnlockedSession()
      migrated.sync?.closeServerConnection()

      await expect(
        utils().loadFavaLibFromUnlockedSession(fixtureV1, sessionFromMigrated, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(StorageVersionError)
    }, 30000)

    it('refuses a vault written by a newer library', async () => {
      const tooNew = JSON.stringify({
        ...(JSON.parse(fixtureV2) as LockedRepresentation),
        storageVersion: 99,
      }) as LockedRepresentationString

      await expect(
        utils().loadFavaLibFromUnlockedSession(tooNew, session, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(StorageVersionError)
    })

    it('refuses an incomplete stored vault', async () => {
      const incomplete = JSON.stringify({
        storageVersion: 2,
      }) as LockedRepresentationString

      await expect(
        utils().loadFavaLibFromUnlockedSession(incomplete, session, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(InitializationError)
    })

    it.each(['kdf', 'envelopeMac'] as const)(
      'refuses a v2 vault with no %s',
      async (field) => {
        // Also proof that requireV2EnvelopeFields is genuinely shared with the
        // password path rather than reimplemented here.
        const parsed = JSON.parse(fixtureV2) as Partial<LockedRepresentation>
        delete parsed[field]

        await expect(
          utils().loadFavaLibFromUnlockedSession(
            JSON.stringify(parsed) as LockedRepresentationString,
            session,
            { connectToSyncServer: false },
          ),
        ).rejects.toThrow(InitializationError)
      },
    )

    it.each(['encryptedVaultState', 'libVersion'] as const)(
      'refuses a tampered %s even with a valid session',
      async (field) => {
        // The session path is not a way around the envelope MAC.
        const lib = await utils().loadFavaLibFromLockedRepesentation(
          fixtureV2,
          V2_FIXTURE_PASSWORD,
          { connectToSyncServer: false },
        )
        const good = lib.storage.exportUnlockedSession()
        lib.sync?.closeServerConnection()

        const parsed = JSON.parse(fixtureV2) as Record<string, unknown>
        const original = parsed[field] as string
        parsed[field] =
          `${original.slice(0, -2)}${original.endsWith('AA') ? 'BB' : 'AA'}`

        await expect(
          utils().loadFavaLibFromUnlockedSession(
            JSON.stringify(parsed) as LockedRepresentationString,
            good,
            { connectToSyncServer: false },
          ),
        ).rejects.toThrow(CryptoError)
      },
      30000,
    )
  })

  describe('the session blob is validated at runtime', () => {
    let good: UnlockedSession
    let stored: LockedRepresentationString

    beforeAll(async () => {
      let saved: LockedRepresentationString
      const result = await createFavaLibForTests((representation) => {
        saved = representation
      })
      await result.favaLib.storage.forceSave()
      stored = saved!
      good = JSON.parse(
        result.favaLib.storage.exportUnlockedSession(),
      ) as UnlockedSession
    })

    const importSession = (session: unknown) =>
      utils().loadFavaLibFromUnlockedSession(
        stored,
        JSON.stringify(session) as UnlockedSessionString,
        { connectToSyncServer: false },
      )

    it('refuses a session that is not json', async () => {
      // An InitializationError, not the bare SyntaxError a consumer cannot
      // sensibly catch.
      await expect(
        utils().loadFavaLibFromUnlockedSession(
          stored,
          '{not json' as UnlockedSessionString,
          { connectToSyncServer: false },
        ),
      ).rejects.toThrow(InitializationError)
    })

    it.each([0, 2, '1', 1.5, null, undefined])(
      'refuses sessionVersion %s',
      async (sessionVersion) => {
        await expect(
          importSession({ ...good, sessionVersion }),
        ).rejects.toThrow(InitializationError)
      },
    )

    it('checks the version before the secrets', async () => {
      // Otherwise a blob from a future shape is reported as corrupt rather
      // than as one this build does not read.
      await expect(importSession({ sessionVersion: 2 })).rejects.toThrow(
        /only reads version/,
      )
    })

    it.each(['privateKey', 'publicKey', 'symmetricKey', 'macKey'] as const)(
      'refuses a session with no %s',
      async (field) => {
        const broken: Record<string, unknown> = { ...good }
        delete broken[field]
        await expect(importSession(broken)).rejects.toThrow(InitializationError)
        await expect(importSession({ ...good, [field]: '' })).rejects.toThrow(
          InitializationError,
        )
      },
    )
  })

  describe('sync', () => {
    it('hands the sync manager the same public key the password path does', async () => {
      // The only test that motivates publicKey being in the blob at all.
      // Without it, dropping the field would go unnoticed until a second
      // device failed to pair.
      let saved: LockedRepresentationString
      const result = await createFavaLibForTests((representation) => {
        saved = representation
      })
      await result.favaLib.setSyncServerUrl('wss://example.com', true)
      await result.favaLib.storage.forceSave()
      const session = result.favaLib.storage.exportUnlockedSession()
      result.favaLib.sync?.closeServerConnection()

      const lib = await utils().loadFavaLibFromUnlockedSession(
        saved!,
        session,
        { connectToSyncServer: false },
      )

      // eslint-disable-next-line @typescript-eslint/dot-notation
      expect(lib.sync!['publicKey']).toBe(result.publicKey)
      lib.sync?.closeServerConnection()
    }, 30000)
  })
})
