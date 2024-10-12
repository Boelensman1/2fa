import NodeCryptoProvider from '../src/CryptoProviders/node/index.mjs'
import {
  getTwoFaLibVaultCreationUtils,
  DeviceId,
  DeviceType,
  type NewEntry,
  type Passphrase,
  type TwoFaLib,
} from '../src/main.mjs'

export const totpEntry: NewEntry = {
  name: 'Test TOTP',
  issuer: 'Test Issuer',
  type: 'TOTP',
  payload: {
    secret: 'TESTSECRET',
    period: 30,
    algorithm: 'SHA-1',
    digits: 6,
  },
}

export const anotherTotpEntry: NewEntry = {
  ...totpEntry,
  name: 'Another TOTP',
  issuer: 'Another Issuer',
}

export const deviceId = 'device-id' as DeviceId
export const deviceType = 'test-device' as DeviceType
export const passphrase = 'w!22M@#GdRKqp#58#9&e' as Passphrase

/**
 * Creates a TwoFaLib instance that can be used for testing.
 * @returns A promise that resolves to the TwoFaLib instance.
 */
export const createTwoFaLibForTests = async () => {
  const cryptoLib = new NodeCryptoProvider()
  const { createNewTwoFaLibVault } = getTwoFaLibVaultCreationUtils(cryptoLib)
  const result = await createNewTwoFaLibVault(deviceType, passphrase, ['test'])

  return { cryptoLib, passphrase, ...result }
}

/**
 * Clears all entries from the vault.
 * @param twoFaLib - The TwoFaLib instance.
 */
export const clearEntries = async (twoFaLib: TwoFaLib) => {
  const entries = twoFaLib.vault.listEntries()
  for (const entryId of entries) {
    await twoFaLib.vault.deleteEntry(entryId)
  }
}

/**
 * Omits the specified keys from an object.
 * @param obj - The object to omit keys from.
 * @param keys - The keys to omit.
 * @returns A new object with the specified keys omitted.
 */
export const omit = (obj: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))
