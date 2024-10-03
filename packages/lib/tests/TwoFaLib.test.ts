import { describe, it, expect, beforeEach, beforeAll } from 'vitest'

import { CryptoLib, TwoFaLib } from '../src/main.mjs'

import { clearEntries, createTwoFaLibForTests } from './testUtils.js'

describe('2falib', () => {
  let cryptoLib: CryptoLib
  let twoFaLib: TwoFaLib

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    cryptoLib = result.cryptoLib
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  describe('TwoFaLib constructor', () => {
    it('should throw an error if device identifier is not provided', () => {
      expect(() => new TwoFaLib('', cryptoLib)).toThrow(
        'Device identifier is required',
      )
    })

    it('should throw an error if device identifier is too long', () => {
      const longDeviceIdentifier = 'a'.repeat(257)
      expect(() => new TwoFaLib(longDeviceIdentifier, cryptoLib)).toThrow(
        'Device identifier is too long, max 256 characters',
      )
    })

    it('should throw an error if CryptoLib is not provided', () => {
      // @ts-expect-error null is not a valid argument for TwoFaLib
      expect(() => new TwoFaLib('valid-device', null)).toThrow(
        'CryptoLib is required',
      )
    })

    it('should create a TwoFaLib instance with valid parameters', () => {
      const validDeviceIdentifier = 'valid-device'
      const twoFaLib = new TwoFaLib(validDeviceIdentifier, cryptoLib)
      expect(twoFaLib).toBeInstanceOf(TwoFaLib)
      expect(twoFaLib.deviceIdentifier).toBe(validDeviceIdentifier)
    })
  })
})
