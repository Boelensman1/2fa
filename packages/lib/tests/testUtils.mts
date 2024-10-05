import NodeCryptoProvider from '../src/CryptoProviders/node/index.mjs'
import {
  createTwoFaLib,
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

export const deviceIdentifier = 'test-device'
export const passphrase = 'testpassword' as Passphrase

export const createTwoFaLibForTests = async () => {
  const cryptoLib = new NodeCryptoProvider()
  const result = await createTwoFaLib(deviceIdentifier, cryptoLib, passphrase)

  return { cryptoLib, passphrase, ...result }
}

export const clearEntries = async (twoFaLib: TwoFaLib) => {
  const entries = twoFaLib.vault.listEntries()
  for (const entryId of entries) {
    await twoFaLib.vault.deleteEntry(entryId)
  }
}

export const omit = (obj: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))
