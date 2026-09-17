import { describe, it, expect } from 'vitest'

import {
  MAX_PUBLIC_KEY_LENGTH,
  validateSyncDevice,
} from '../../src/utils/syncDeviceValidation.mjs'

const pem = (body: string, eol = '\n') =>
  ['-----BEGIN PUBLIC KEY-----', body, '-----END PUBLIC KEY-----'].join(eol)

const validDevice = {
  deviceId: 'a5b4e2b0-1f4e-4a4a-9a0e-2d9b5d5a1c11',
  publicKey: pem('MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA'),
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

  // node writes PEM with \n and node-forge with \r\n, and canonical.mts
  // already records that both reach the same fields. A check that accepted only
  // one of them would pass within a provider and fail across them -- which is
  // exactly the class of bug fixtures.test.mts exists to catch.
  it.each([
    ['unix line endings', '\n'],
    ['windows line endings', '\r\n'],
  ])('accepts a PEM with %s', (_label, eol) => {
    expect(
      validateSyncDevice(deviceWith({ publicKey: pem('AAAA', eol) })),
    ).toBeNull()
  })

  it('accepts a PEM with surrounding whitespace', () => {
    expect(
      validateSyncDevice(deviceWith({ publicKey: `\n${pem('AAAA')}\n` })),
    ).toBeNull()
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
    ['a non-string publicKey', { publicKey: { pem: 'nope' } }],
    [
      'a private key PEM',
      {
        publicKey:
          '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----',
      },
    ],
    ['a PEM with no footer', { publicKey: '-----BEGIN PUBLIC KEY-----\nAAAA' }],
    ['a bare base64 key', { publicKey: 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8A' }],
    ['a non-object deviceInfo', { deviceInfo: 'cli' }],
    ['a deviceInfo with no deviceType', { deviceInfo: {} }],
    [
      'a deviceInfo with an empty deviceFriendlyName',
      { deviceInfo: { deviceType: '2fa-cli', deviceFriendlyName: '' } },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(validateSyncDevice(deviceWith(overrides))).not.toBeNull()
  })

  it('rejects an over-long publicKey', () => {
    // The cap is what stops a device record being used as a blob store: the
    // list is not bounded by anything the user sees.
    const body = 'A'.repeat(MAX_PUBLIC_KEY_LENGTH)
    expect(
      validateSyncDevice(deviceWith({ publicKey: pem(body) })),
    ).not.toBeNull()
  })

  it('names what is wrong', () => {
    expect(validateSyncDevice(deviceWith({ publicKey: 'nope' }))).toMatch(
      /publicKey/,
    )
  })
})
