import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { describe, it, expect, beforeAll } from 'vitest'

import {
  getFavaLibVaultCreationUtils,
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

      const { symmetricKey } = await browserCrypto.decryptKeys(
        parsed.encryptedPrivateKey,
        parsed.encryptedSymmetricKey,
        parsed.salt,
        FIXTURE_PASSWORD,
      )
      const vaultState = JSON.parse(
        await browserCrypto.decryptSymmetric(
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
})
