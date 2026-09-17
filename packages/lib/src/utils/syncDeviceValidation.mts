import type { DeviceInfo, SyncDevice } from '../interfaces/SyncTypes.mjs'

/**
 * The most devices a vault's stored device list may hold.
 *
 * Counted on the STORED list, which includes this device's own record --
 * `SyncManager.getSyncDevices()` filters that one out, so the number a user
 * sees is one lower. Both places that enforce the cap (the load path in
 * creationUtils and `SyncManager.addSyncDevice`) count the stored list, so they
 * agree about the same vault.
 *
 * Not a capacity limit -- it is a bound on how much damage one malformed or
 * hostile vault state can do. Every outgoing command is encrypted once per
 * device (`SyncManager.sendCommand`), so an unbounded list is an unbounded
 * amount of RSA work per keystroke.
 */
export const MAX_SYNC_DEVICES = 64

/**
 * The longest a public key PEM may be. An RSA-4096 SPKI PEM is around 800
 * characters, so this leaves room for a larger key without leaving room for a
 * blob.
 */
export const MAX_PUBLIC_KEY_LENGTH = 4096

/** The longest a device id may be. Ours are uuidv4, but a peer's is a string. */
const MAX_DEVICE_ID_LENGTH = 256

/** The longest a deviceType or deviceFriendlyName may be. */
const MAX_DEVICE_NAME_LENGTH = 256

const PEM_HEADER = '-----BEGIN PUBLIC KEY-----'
const PEM_FOOTER = '-----END PUBLIC KEY-----'

/**
 * Checks that a value is a string within a length limit.
 * @param value - The value to check.
 * @param maxLength - The longest the value may be.
 * @returns True when the value is a usable non-empty string.
 */
const isBoundedString = (value: unknown, maxLength: number): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength

/**
 * Checks the optional deviceInfo of a sync device.
 * @param deviceInfo - The value to check, which may be anything at all.
 * @returns Null when it is usable or absent, otherwise the reason it is not.
 */
const validateDeviceInfo = (deviceInfo: unknown): string | null => {
  if (deviceInfo === undefined || deviceInfo === null) {
    return null
  }
  if (typeof deviceInfo !== 'object') {
    return 'device.deviceInfo is not an object'
  }

  const { deviceType, deviceFriendlyName } = deviceInfo as Partial<DeviceInfo>

  if (!isBoundedString(deviceType, MAX_DEVICE_NAME_LENGTH)) {
    return 'device.deviceInfo.deviceType is missing or too long'
  }
  if (
    deviceFriendlyName !== undefined &&
    deviceFriendlyName !== null &&
    !isBoundedString(deviceFriendlyName, MAX_DEVICE_NAME_LENGTH)
  ) {
    return 'device.deviceInfo.deviceFriendlyName is empty or too long'
  }

  return null
}

/**
 * Checks the parts of a sync device without which it is simply unusable.
 *
 * This is a *shape* gate, not a key validity gate. It deliberately does not
 * parse the PEM: that would pull a platform provider into a leaf util, and the
 * two providers disagree about line endings anyway -- node writes `\n` and
 * node-forge `\r\n`, which is why the header and footer are matched against the
 * trimmed string rather than with a whole-string regex. See
 * `canonical.mts`'s note on the same split.
 *
 * It is also **not** the check that makes device enrolment safe. A well formed
 * record carrying an attacker's public key passes every test here; nothing
 * authenticates the sender of an `AddSyncDeviceCommand`. That is
 * key-hierarchy-review/14-sync-device-injection.md, and it stays open.
 * @param raw - The device to check, which may be anything at all.
 * @returns Null when the device is usable, otherwise the reason it is not.
 */
export const validateSyncDevice = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null) {
    return 'device is not an object'
  }

  const device = raw as Partial<SyncDevice>

  if (!isBoundedString(device.deviceId, MAX_DEVICE_ID_LENGTH)) {
    return 'device has no usable deviceId'
  }
  if (!isBoundedString(device.publicKey, MAX_PUBLIC_KEY_LENGTH)) {
    return 'device has no usable publicKey'
  }

  const publicKey = (device.publicKey as string).trim()
  if (!publicKey.startsWith(PEM_HEADER) || !publicKey.endsWith(PEM_FOOTER)) {
    return 'device.publicKey is not a public key PEM'
  }

  return validateDeviceInfo(device.deviceInfo)
}
