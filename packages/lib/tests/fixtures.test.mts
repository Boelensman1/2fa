import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll } from 'vitest'

import {
  getFavaLibVaultCreationUtils,
  UnsupportedStorageVersionError,
  V2_KDF_PARAMETERS,
  type DeviceType,
  type EntryId,
  type FavaLib,
  type LockedRepresentation,
  type LockedRepresentationString,
  type Password,
} from '../src/main.mjs'
import { nodeProviders } from '../src/platformProviders/node/index.mjs'
import { browserProviders } from '../src/platformProviders/browser/index.mjs'

// See tests/fixtures/README.md. This vault is frozen: written by favalib 0.0.21
// at commit e88f50b, never to be regenerated. Storage version 1 is no longer
// readable, so what it pins now is the REFUSAL: a v1 blob dropped over a
// current vault must not open, and must not be rewritten in the attempt.
const FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v1' as Password

const FIXED_TIMESTAMP = 1_700_000_000_000

const fixture = readFileSync(
  new URL('./fixtures/vault-v1.json', import.meta.url),
  'utf8',
) as LockedRepresentationString

// The v2 fixture. Same two secrets as the v1 one, so the same expected OTPs
// apply -- and those were cross-checked against an independent RFC 6238
// implementation.
// Regenerated twice, both times because storage version 2 was REDEFINED rather
// than superseded: once when the RSA layer became X25519/Ed25519, and again
// when those gained their post-quantum halves. See tests/fixtures/README.md on
// why that is not a breach of the never-regenerate rule. That the OTPs came
// back unchanged across all three is the end-to-end evidence that each new
// chain is correct and not merely self-consistent.
const V2_FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v2' as Password
const V2_FIXTURE_DEVICE_ID = 'd607e80d-b0af-409b-8e0f-9b983c5bcbf4'
const V2_ENTRY_ONE = {
  id: '1a0ec6e3-fab6-49bc-b8f7-3c755f7cc271' as EntryId,
  name: 'Fixture Entry One',
  otpAtFixedTimestamp: '324550',
}
const V2_ENTRY_TWO = {
  id: 'c4c1184c-571c-4f84-9227-3aee8a3681ad' as EntryId,
  name: 'Fixture Entry Two',
  otpAtFixedTimestamp: '017492',
}
const fixtureV2 = readFileSync(
  new URL('./fixtures/vault-v2.json', import.meta.url),
  'utf8',
) as LockedRepresentationString

describe('stored format fixtures', () => {
  describe('vault-v1.json is refused, not migrated', () => {
    /**
     * Builds creation utils that record every save, so a test can assert that
     * a refused load wrote nothing.
     * @param providers - The platform providers to load with.
     * @returns The utils and the array the save function appends to.
     */
    const utilsRecordingSaves = (providers = nodeProviders) => {
      const written: LockedRepresentationString[] = []
      const utils = getFavaLibVaultCreationUtils(
        providers,
        'fixture-device' as DeviceType,
        ['fixture'],
        (representation) => {
          written.push(representation)
        },
      )
      return { utils, written }
    }

    it('still declares storage version 1', () => {
      const parsed = JSON.parse(fixture) as LockedRepresentation
      expect(parsed.storageVersion).toBe(1)
      expect(parsed.libVersion).toBe('0.0.21')
    })

    it('is refused by the password path, with the correct password', async () => {
      // The correct password, on purpose: the refusal must happen at the
      // version gate, before anything is derived or decrypted, so it cannot
      // depend on the password being wrong.
      const { utils, written } = utilsRecordingSaves()

      await expect(
        utils.loadFavaLibFromLockedRepesentation(fixture, FIXTURE_PASSWORD, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(UnsupportedStorageVersionError)

      // Nothing was written: the downgrade window was a v1 blob opening AND
      // being rewritten in place.
      expect(written).toEqual([])
    })

    it('says how to get the data across', async () => {
      const { utils } = utilsRecordingSaves()

      await expect(
        utils.loadFavaLibFromLockedRepesentation(fixture, FIXTURE_PASSWORD, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(/export your entries/i)
    })

    it('is refused when the storageVersion field is absent entirely', async () => {
      // A vault written before the field existed. It must not be assumed to be
      // the current version, and it must not be assumed readable.
      const parsed = JSON.parse(fixture) as Partial<LockedRepresentation>
      delete parsed.storageVersion
      const { utils, written } = utilsRecordingSaves()

      await expect(
        utils.loadFavaLibFromLockedRepesentation(
          JSON.stringify(parsed) as LockedRepresentationString,
          FIXTURE_PASSWORD,
          { connectToSyncServer: false },
        ),
      ).rejects.toThrow(UnsupportedStorageVersionError)
      expect(written).toEqual([])
    })

    it('is refused by the browser provider as well', async () => {
      // The gate is shared, but asserting it per provider is what stops a
      // future provider-local read path from quietly reopening the window.
      const { utils, written } = utilsRecordingSaves(browserProviders)

      await expect(
        utils.loadFavaLibFromLockedRepesentation(fixture, FIXTURE_PASSWORD, {
          connectToSyncServer: false,
        }),
      ).rejects.toThrow(UnsupportedStorageVersionError)
      expect(written).toEqual([])
    })
  })

  describe('vault-v2.json', () => {
    let favaLib: FavaLib

    beforeAll(async () => {
      // No saveFunction, same as the v1 block: a test run must never rewrite a
      // checked-in fixture. A v2 vault needs no migration anyway.
      const { loadFavaLibFromLockedRepesentation } =
        getFavaLibVaultCreationUtils(
          nodeProviders,
          'fixture-device' as DeviceType,
          ['fixture'],
        )

      favaLib = await loadFavaLibFromLockedRepesentation(
        fixtureV2,
        V2_FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await favaLib.ready
    })

    it('declares storage version 2 and the v2 kdf parameters', () => {
      const parsed = JSON.parse(fixtureV2) as LockedRepresentation
      expect(parsed.storageVersion).toBe(2)
      expect(parsed.kdf).toEqual(V2_KDF_PARAMETERS)
      expect(parsed.envelopeMac).toEqual(expect.any(String))
      expect(parsed.encryptedVaultState.startsWith('v2:')).toBe(true)
    })

    it('opens with the node provider and keeps its device identity', () => {
      expect(favaLib.meta.deviceId).toBe(V2_FIXTURE_DEVICE_ID)
    })

    it('produces the same OTPs it did when it was written', async () => {
      // As with v1, this one assertion pins the whole chain: the v2 argon2id
      // parameters, the HKDF-derived key-wrap keys, the AES-GCM seal over the
      // device's two composite secret keys, the "v2:nonce:ct||tag" envelope
      // with its at-rest AAD, the envelope MAC, and the TOTP derivation.
      for (const expected of [V2_ENTRY_ONE, V2_ENTRY_TWO]) {
        const token = await favaLib.vault.generateTokenForEntry(
          expected.id,
          FIXED_TIMESTAMP,
        )
        expect(token.otp).toBe(expected.otpAtFixedTimestamp)
      }
    })

    it('is readable by the browser provider too', async () => {
      // Written by the node provider; opening it with the browser one gates
      // the v2 format on both implementations -- the two share their
      // asymmetric code but not their AES, HKDF or argon2, so this is where a
      // disagreement between those would surface.
      const { loadFavaLibFromLockedRepesentation } =
        getFavaLibVaultCreationUtils(
          browserProviders,
          'fixture-device' as DeviceType,
          ['fixture'],
        )
      const inBrowser = await loadFavaLibFromLockedRepesentation(
        fixtureV2,
        V2_FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await inBrowser.ready

      expect(inBrowser.meta.deviceId).toBe(V2_FIXTURE_DEVICE_ID)
      expect(
        inBrowser.vault
          .listEntriesMetas()
          .map((entry) => entry.id)
          .sort(),
      ).toEqual([V2_ENTRY_ONE.id, V2_ENTRY_TWO.id].sort())
      inBrowser.sync?.closeServerConnection()
    })
  })
})
