import { describe, it, expect } from 'vitest'

import {
  deviceLabel,
  deviceName,
  type DeviceLabelSource,
} from '../../src/utils/deviceLabel.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  DeviceType,
} from '../../src/interfaces/SyncTypes.mjs'

const deviceId = 'f95580c4-68b2-4fdb-876f-8fa190ba8e7a' as DeviceId

/**
 * The flattened shape, as `getSyncDevices` reports it.
 * @param name - The friendly name the device claims, if any.
 * @param type - The device type it claims, if any.
 * @param id - The device id, if not the default one.
 * @returns The device, as a consumer of the public list sees it.
 */
const flat = (
  name?: string,
  type?: string,
  id: DeviceId = deviceId,
): DeviceLabelSource => ({
  deviceId: id,
  deviceFriendlyName: name as DeviceFriendlyName | undefined,
  deviceType: type as DeviceType | undefined,
})

/**
 * The stored shape, where the same two fields are nested in deviceInfo.
 * @param name - The friendly name the device claims, if any.
 * @param type - The device type it claims, if any.
 * @returns The device, as the vault stores it.
 */
const nested = (name?: string, type?: string): DeviceLabelSource => ({
  deviceId,
  deviceInfo: {
    deviceType: type as DeviceType,
    deviceFriendlyName: name as DeviceFriendlyName | undefined,
  },
})

describe('deviceLabel', () => {
  it('shows a name, a type and an id when it has all three', () => {
    expect(deviceLabel(flat('work laptop', 'cli'))).toBe(
      `"work laptop" (cli, ${deviceId})`,
    )
  })

  it('shows the name and the id when there is no type', () => {
    expect(deviceLabel(flat('work laptop'))).toBe(`"work laptop" (${deviceId})`)
  })

  it('shows the type and the id when the device never named itself', () => {
    expect(deviceLabel(flat(undefined, 'cli'))).toBe(`cli (${deviceId})`)
  })

  it('falls back to the id alone', () => {
    expect(deviceLabel(flat())).toBe(deviceId)
  })

  it('reads the nested shape the same way as the flat one', () => {
    // SyncDevice nests deviceInfo, PublicSyncDevice flattens it, and a caller
    // holding either must not have to know which.
    expect(deviceLabel(nested('work laptop', 'cli'))).toBe(
      deviceLabel(flat('work laptop', 'cli')),
    )
  })

  it('keeps the id visible when the name is enormous', () => {
    // Capped per field rather than only per message: validation allows 256
    // characters, and without this one name eats the line the fingerprint was
    // meant to share.
    const label = deviceLabel(flat('n'.repeat(256), 'cli'))
    expect(label).toContain(deviceId)
    expect(label).toContain('…')
    expect(label.length).toBeLessThan(140)
  })

  it('treats a name that sanitises away as no name at all', () => {
    // Otherwise the fallback chain stops at an empty pair of quotes.
    expect(deviceLabel(flat('\r\n', 'cli'))).toBe(`cli (${deviceId})`)
  })

  it('says so rather than showing nothing when the id is unprintable', () => {
    // Validation requires a non-empty deviceId and checks nothing else, so a
    // peer may hold one made entirely of characters that must not be printed.
    expect(deviceLabel(flat(undefined, undefined, '\r\r' as DeviceId))).toBe(
      '(unprintable device id)',
    )
  })
})

describe('deviceName', () => {
  it('prefers the friendly name', () => {
    expect(deviceName(flat('work laptop', 'cli'))).toBe('work laptop')
  })

  it('falls back to the device type', () => {
    expect(deviceName(flat(undefined, 'cli'))).toBe('cli')
  })

  it('falls back to the device id', () => {
    // Better than an invented placeholder: the id is at least the thing the
    // device is listed under.
    expect(deviceName(flat())).toBe(deviceId)
  })

  it('cleans what it returns', () => {
    expect(deviceName(flat('evil\rname'))).toBe('evil name')
  })
})
