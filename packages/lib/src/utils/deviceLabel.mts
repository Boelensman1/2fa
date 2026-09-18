import { sanitiseForDisplay } from './safeText.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  DeviceInfo,
  DeviceType,
} from '../interfaces/SyncTypes.mjs'

/**
 * Anything a device's name can be read off.
 *
 * Both shapes at once: `SyncDevice`, which nests `deviceInfo`, and
 * `PublicSyncDevice`, which flattens it. One signature rather than two
 * overloads, so that a caller cannot pick the one that silently reads nothing
 * from the shape it is holding.
 */
export interface DeviceLabelSource {
  deviceId: DeviceId
  deviceType?: DeviceType
  deviceFriendlyName?: DeviceFriendlyName
  deviceInfo?: DeviceInfo
}

/**
 * How much of a name or a device type is shown.
 *
 * Both are 256 characters as far as validation is concerned, and a label's
 * whole job is to sit in a line next to a fingerprint. Capped here as well as
 * in `FavaLib.log`, because the message-level cap cannot tell which part of a
 * sentence to spend its budget on -- without this, one 256-character name eats
 * the line the fingerprint was meant to be on.
 */
const MAX_NAME_LENGTH = 48

/** How much of a device id is shown. Ours are 36-character uuidv4s. */
const MAX_ID_LENGTH = 64

/**
 * What is shown for a device id that sanitises away to nothing.
 *
 * Validation requires a non-empty deviceId and checks nothing else, so a peer
 * may hold one made entirely of characters that must not be printed. Saying so
 * beats printing an empty string where the reader expects an identifier.
 */
const UNPRINTABLE_ID = '(unprintable device id)'

/**
 * Cleans an optional peer-supplied string, treating unprintable as absent.
 *
 * A name of nothing but control characters has to come back `undefined` rather
 * than `''`, so that the fallback chain moves on to the next field instead of
 * rendering an empty pair of quotes.
 * @param value - The string, if the device supplied one.
 * @param maxLength - The longest the result may be.
 * @returns The cleaned string, or undefined if there is nothing left of it.
 */
const cleanOptional = (value: string | undefined, maxLength: number) => {
  if (value === undefined) {
    return undefined
  }
  const cleaned = sanitiseForDisplay(value, maxLength)
  return cleaned === '' ? undefined : cleaned
}

/**
 * Reads a device's name and type out of either shape, made safe to print.
 * @param device - The device.
 * @returns The name and type it claims, cleaned, either possibly absent.
 */
const claims = (device: DeviceLabelSource) => ({
  name: cleanOptional(
    device.deviceFriendlyName ?? device.deviceInfo?.deviceFriendlyName,
    MAX_NAME_LENGTH,
  ),
  type: cleanOptional(
    device.deviceType ?? device.deviceInfo?.deviceType,
    MAX_NAME_LENGTH,
  ),
  id: cleanOptional(device.deviceId, MAX_ID_LENGTH) ?? UNPRINTABLE_ID,
})

/**
 * The best name a device has.
 *
 * For a list row, where the id is already on the row somewhere else. Never
 * empty: a device always has an id, and a device that says nothing about itself
 * is better shown as its id than as an invented placeholder.
 * @param device - The device.
 * @returns The friendly name, else the device type, else the device id.
 */
export const deviceName = (device: DeviceLabelSource): string => {
  const { name, type, id } = claims(device)
  return name ?? type ?? id
}

/**
 * The name a device claims plus what actually identifies it, for one line of
 * prose.
 *
 * Says nothing about whether the name is true -- it cannot, because the device
 * being described is the one that chose it. That is what a fingerprint printed
 * alongside is for, and why the id is here too.
 * @param device - The device.
 * @returns e.g. `"work laptop" (cli, f95580c4-...)`, or the id on its own.
 */
export const deviceLabel = (device: DeviceLabelSource): string => {
  const { name, type, id } = claims(device)
  if (name && type) {
    return `"${name}" (${type}, ${id})`
  }
  if (name) {
    return `"${name}" (${id})`
  }
  if (type) {
    return `${type} (${id})`
  }
  return id
}
