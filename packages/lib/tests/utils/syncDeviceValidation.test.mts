import { describe, it, expect } from 'vitest'

import {
  PUBLIC_KEY_LENGTH,
  parseDevicePublicKeys,
  validateSyncDevice,
} from '../../src/utils/syncDeviceValidation.mjs'

/**
 * Builds a base64 key of exactly the right length: 32 raw bytes.
 * @param fill - The character to repeat, so two keys can be told apart.
 * @returns The base64 key.
 */
const key = (fill = 'A') => fill.repeat(43) + '='

const validDevice = {
  deviceId: 'a5b4e2b0-1f4e-4a4a-9a0e-2d9b5d5a1c11',
  publicKey: key('A'),
  signingPublicKey: key('B'),
  deviceInfo: { deviceType: '2fa-cli', deviceFriendlyName: 'my-laptop' },
}

/**
 * Builds a sync device with the given overrides.
 * @param overrides - The fields to override.
 * @returns The device.
 */
const deviceWith = (overrides: Record<string, unknown>): unknown => ({
  ...validDevice,
  ...overrides,
})

describe('validateSyncDevice', () => {
  it('accepts a well-formed device', () => {
    expect(validateSyncDevice(validDevice)).toBeNull()
  })

  it('accepts a device with no deviceInfo', () => {
    expect(validateSyncDevice(deviceWith({ deviceInfo: undefined }))).toBeNull()
  })

  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
  ])('rejects %s', (_label, raw) => {
    // An array is an object, so it passes the typeof gate and has to be caught
    // by the deviceId check below it.
    expect(validateSyncDevice(raw)).not.toBeNull()
  })

  it.each([
    ['a missing deviceId', { deviceId: undefined }],
    ['an empty deviceId', { deviceId: '' }],
    ['a non-string deviceId', { deviceId: 42 }],
    ['an over-long deviceId', { deviceId: 'x'.repeat(257) }],
    ['a missing publicKey', { publicKey: undefined }],
    ['an empty publicKey', { publicKey: '' }],
    ['a non-string publicKey', { publicKey: { key: 'nope' } }],
    ['a missing signingPublicKey', { signingPublicKey: undefined }],
    ['a non-string signingPublicKey', { signingPublicKey: 42 }],
    ['a non-object deviceInfo', { deviceInfo: 'cli' }],
    ['a deviceInfo with no deviceType', { deviceInfo: {} }],
    [
      'a deviceInfo with an empty deviceFriendlyName',
      { deviceInfo: { deviceType: '2fa-cli', deviceFriendlyName: '' } },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(validateSyncDevice(deviceWith(overrides))).not.toBeNull()
  })

  // Storage version 1's RSA keys could only be bounded; a curve key has one
  // correct length, so anything else is refused outright rather than passed on
  // to a curve that would name the primitive in its error message.
  it.each([
    ['one character short', key().slice(0, PUBLIC_KEY_LENGTH - 1)],
    ['one character long', key() + 'A'],
    ['a PEM', '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'],
    ['right length, not base64', '!'.repeat(PUBLIC_KEY_LENGTH)],
  ])('rejects a publicKey that is %s', (_label, publicKey) => {
    expect(validateSyncDevice(deviceWith({ publicKey }))).not.toBeNull()
    expect(
      validateSyncDevice(deviceWith({ signingPublicKey: publicKey })),
    ).not.toBeNull()
  })

  it('names which key is wrong', () => {
    expect(validateSyncDevice(deviceWith({ publicKey: 'nope' }))).toMatch(
      /publicKey/,
    )
    expect(
      validateSyncDevice(deviceWith({ signingPublicKey: 'nope' })),
    ).toMatch(/signingPublicKey/)
  })
})

describe('parseDevicePublicKeys', () => {
  it('reads a well-formed pair', () => {
    expect(
      parseDevicePublicKeys(
        JSON.stringify({ publicKey: key('A'), signingPublicKey: key('B') }),
      ),
    ).toEqual({ publicKey: key('A'), signingPublicKey: key('B') })
  })

  it.each([
    ['not JSON', 'not json at all'],
    ['JSON that is not an object', '"a string"'],
    ['a pair with one key missing', JSON.stringify({ publicKey: key() })],
    [
      'a pair with an unusable key',
      JSON.stringify({ publicKey: key(), signingPublicKey: 'short' }),
    ],
  ])('refuses %s', (_label, serialised) => {
    expect(() => parseDevicePublicKeys(serialised)).toThrow(/public keys/)
  })
})
