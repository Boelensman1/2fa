import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'

import {
  getFavaLibVaultCreationUtils,
  STORAGE_VERSION,
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
import type { VaultState } from '../src/interfaces/Vault.mjs'
import { buildVaultAad } from '../src/utils/canonical.mjs'

// The browser CryptoLib reads window.crypto inside its method bodies only, and
// nothing in src/ does environment detection, so this shim cannot perturb the
// node half of this file. Same trick as CryptoProviders/compare-node-browser.
// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

// See tests/fixtures/README.md. This vault is frozen: it was written by
// favalib 0.0.21 at commit e88f50b and must never be regenerated, because its
// entire value is that it predates any change to the stored format.
const FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v1' as Password
const FIXTURE_DEVICE_ID = '91b8a8bf-3450-4e68-94db-4d6051901ffa'

const ENTRY_ONE = {
  id: 'e6c4f652-bf77-4ca4-be3a-8b06dc63dd21' as EntryId,
  name: 'Fixture Entry One',
  issuer: 'Fixture Issuer A',
  // Cross-checked against an independent RFC 6238 implementation, so this
  // pins real correctness rather than agreement with ourselves.
  otpAtFixedTimestamp: '324550',
}
const ENTRY_TWO = {
  id: '01d91809-ae5d-4385-ad26-bee175020361' as EntryId,
  name: 'Fixture Entry Two',
  issuer: 'Fixture Issuer B',
  otpAtFixedTimestamp: '017492',
}
const FIXED_TIMESTAMP = 1_700_000_000_000

const fixture = readFileSync(
  new URL('./fixtures/vault-v1.json', import.meta.url),
  'utf8',
) as LockedRepresentationString

// The v2 fixture. Same two secrets as v1, so the same expected OTPs apply --
// and those were cross-checked against an independent RFC 6238 implementation.
const V2_FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v2' as Password
const V2_FIXTURE_DEVICE_ID = '9ad6d991-a1b0-45a2-8e3f-01de0a956272'
const V2_ENTRY_ONE = {
  id: '9898f013-9e8c-412b-b892-a5eb8a583851' as EntryId,
  name: 'Fixture Entry One',
  otpAtFixedTimestamp: '324550',
}
const V2_ENTRY_TWO = {
  id: '09e3a359-3764-4a73-ba55-bc5ce2fec2d5' as EntryId,
  name: 'Fixture Entry Two',
  otpAtFixedTimestamp: '017492',
}
const fixtureV2 = readFileSync(
  new URL('./fixtures/vault-v2.json', import.meta.url),
  'utf8',
) as LockedRepresentationString

describe('stored format fixtures', () => {
  describe('vault-v1.json', () => {
    let favaLib: FavaLib

    beforeAll(async () => {
      // Deliberately no saveFunction: PersistentStorageManager.save() is a
      // no-op without one, so a test run can never rewrite the checked-in file.
      const { loadFavaLibFromLockedRepesentation } =
        getFavaLibVaultCreationUtils(
          nodeProviders,
          'fixture-device' as DeviceType,
          ['fixture'],
        )

      favaLib = await loadFavaLibFromLockedRepesentation(
        fixture,
        FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await favaLib.ready
    })

    it('still declares storage version 1', () => {
      const parsed = JSON.parse(fixture) as LockedRepresentation
      expect(parsed.storageVersion).toBe(1)
      expect(parsed.libVersion).toBe('0.0.21')
    })

    it('opens with the node provider and keeps its device identity', () => {
      expect(favaLib.meta.deviceId).toBe(FIXTURE_DEVICE_ID)
    })

    it('round-trips both entries', () => {
      const metas = favaLib.vault.listEntriesMetas()
      expect(metas).toHaveLength(2)

      for (const expected of [ENTRY_ONE, ENTRY_TWO]) {
        const meta = metas.find((m) => m.id === expected.id)
        expect(meta, `entry ${expected.id} is missing`).toBeDefined()
        expect(meta!.name).toBe(expected.name)
        expect(meta!.issuer).toBe(expected.issuer)
        expect(meta!.type).toBe('TOTP')
      }
    })

    it('produces the same OTPs it did when it was written', async () => {
      // This single assertion pins the whole chain: argon2id parameters, the
      // PBES2-wrapped RSA key, RSA-OAEP unwrapping of the symmetric key, the
      // AES-CBC "base64(iv):base64(ct)" encoding, and the TOTP derivation.
      for (const expected of [ENTRY_ONE, ENTRY_TWO]) {
        const token = await favaLib.vault.generateTokenForEntry(
          expected.id,
          FIXED_TIMESTAMP,
        )
        expect(token.otp).toBe(expected.otpAtFixedTimestamp)
      }
    })

    it('is readable by the browser provider too', async () => {
      // The fixture was written by the node provider. Decrypting it with the
      // browser one gates the stored format on both implementations, which a
      // fresh round trip inside a single provider cannot do.
      const browserCrypto = new browserProviders.CryptoLib()
      const parsed = JSON.parse(fixture) as LockedRepresentation

      // decryptKeysV1 / decryptSymmetricV1 deliberately, not the v2 pair:
      // this fixture IS a v1 blob, and reading it is the one thing the legacy
      // path exists for.
      const { symmetricKey } = await browserCrypto.decryptKeysV1(
        parsed.encryptedPrivateKey,
        parsed.encryptedSymmetricKey,
        parsed.salt,
        FIXTURE_PASSWORD,
      )
      const vaultState = JSON.parse(
        await browserCrypto.decryptSymmetricV1(
          symmetricKey,
          parsed.encryptedVaultState,
        ),
      ) as VaultState

      expect(vaultState.deviceId).toBe(FIXTURE_DEVICE_ID)
      expect(vaultState.vault.map((entry) => entry.id)).toEqual([
        ENTRY_ONE.id,
        ENTRY_TWO.id,
      ])
      expect(vaultState.vault[0].payload.secret).toBe('JBSWY3DPEHPK3PXP')
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
      // parameters, the PBES2-wrapped RSA key, RSA-OAEP/MGF1-SHA-256
      // unwrapping, the "v2:nonce:ct||tag" AES-GCM envelope with its at-rest
      // AAD, the envelope MAC, and the TOTP derivation.
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
      // the v2 format on both implementations. This is also where the
      // encryptedPrivateKey-digest line-ending trap in the at-rest AAD would
      // surface, since node writes PEM with "\n" and node-forge with "\r\n".
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

  describe('vault-v1.json is migrated to the current storage version', () => {
    /**
     * Loads the fixture with a capturing save function, so the migration
     * actually persists.
     * @param providers - The platform providers to load with.
     * @returns The loaded library and whatever it wrote.
     */
    const loadAndCapture = async (providers = nodeProviders) => {
      let written: LockedRepresentationString | undefined
      const { loadFavaLibFromLockedRepesentation } =
        getFavaLibVaultCreationUtils(
          providers,
          'fixture-device' as DeviceType,
          ['fixture'],
          (representation) => {
            written = representation
          },
        )
      const lib = await loadFavaLibFromLockedRepesentation(
        fixture,
        FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await lib.ready
      return { lib, written }
    }

    it('re-wraps to the current version on a successful unlock', async () => {
      const { lib, written } = await loadAndCapture()

      expect(written, 'the migration did not save').toBeDefined()
      const migrated = JSON.parse(written!) as LockedRepresentation
      expect(migrated.storageVersion).toBe(STORAGE_VERSION)
      expect(migrated.kdf).toEqual(V2_KDF_PARAMETERS)
      expect(migrated.envelopeMac).toEqual(expect.any(String))
      // A fresh salt, and a v2 ciphertext envelope.
      expect(migrated.salt).not.toBe(
        (JSON.parse(fixture) as LockedRepresentation).salt,
      )
      expect(migrated.encryptedVaultState.startsWith('v2:')).toBe(true)

      lib.sync?.closeServerConnection()
    })

    it('reopens at v2 with the same entries and the same OTPs', async () => {
      const { lib: first, written } = await loadAndCapture()
      first.sync?.closeServerConnection()

      const { loadFavaLibFromLockedRepesentation } =
        getFavaLibVaultCreationUtils(
          nodeProviders,
          'fixture-device' as DeviceType,
          ['fixture'],
        )
      const reopened = await loadFavaLibFromLockedRepesentation(
        written!,
        FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await reopened.ready

      expect(reopened.meta.deviceId).toBe(FIXTURE_DEVICE_ID)
      for (const expected of [ENTRY_ONE, ENTRY_TWO]) {
        const token = await reopened.vault.generateTokenForEntry(
          expected.id,
          FIXED_TIMESTAMP,
        )
        expect(token.otp).toBe(expected.otpAtFixedTimestamp)
      }
      reopened.sync?.closeServerConnection()
    })

    it('clears the command send queue', async () => {
      // A v1 queue holds v1-CBC payloads with MGF1-SHA-1 key wraps, which
      // every upgraded peer now rejects. Carrying them across would have a
      // freshly migrated device ship undeliverable traffic immediately.
      const { lib, written } = await loadAndCapture()
      lib.sync?.closeServerConnection()

      const migrated = JSON.parse(written!) as LockedRepresentation
      const crypto = new nodeProviders.CryptoLib()
      const { symmetricKey } = await crypto.decryptKeys(
        migrated.encryptedPrivateKey,
        migrated.encryptedSymmetricKey,
        migrated.salt,
        FIXTURE_PASSWORD,
        migrated.kdf,
      )
      const state = JSON.parse(
        await crypto.decryptSymmetric(
          symmetricKey,
          migrated.encryptedVaultState,
          buildVaultAad(
            migrated.storageVersion,
            migrated.salt,
            migrated.kdf,
            await crypto.sha256(migrated.encryptedPrivateKey),
          ),
        ),
      ) as VaultState

      expect(state.sync.commandSendQueue).toEqual([])
    })

    it('a vault migrated by node opens in the browser, and vice versa', async () => {
      // The at-rest AAD folds in a SHA-256 of encryptedPrivateKey, and node
      // writes PEM with "\n" while node-forge writes "\r\n". Hashing anything
      // but the exact stored bytes would pass within one provider and fail
      // across them, which is the case a user hits on their second device.
      const { lib: nodeLib, written: nodeWrote } =
        await loadAndCapture(nodeProviders)
      nodeLib.sync?.closeServerConnection()
      const { lib: browserLib, written: browserWrote } =
        await loadAndCapture(browserProviders)
      browserLib.sync?.closeServerConnection()

      const browserUtils = getFavaLibVaultCreationUtils(
        browserProviders,
        'fixture-device' as DeviceType,
        ['fixture'],
      )
      const nodeUtils = getFavaLibVaultCreationUtils(
        nodeProviders,
        'fixture-device' as DeviceType,
        ['fixture'],
      )

      const inBrowser = await browserUtils.loadFavaLibFromLockedRepesentation(
        nodeWrote!,
        FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await inBrowser.ready
      expect(inBrowser.vault.listEntriesMetas()).toHaveLength(2)
      inBrowser.sync?.closeServerConnection()

      const inNode = await nodeUtils.loadFavaLibFromLockedRepesentation(
        browserWrote!,
        FIXTURE_PASSWORD,
        { connectToSyncServer: false },
      )
      await inNode.ready
      expect(inNode.vault.listEntriesMetas()).toHaveLength(2)
      inNode.sync?.closeServerConnection()
    })
  })
})
