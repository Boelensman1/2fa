import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  Password,
  PlatformProviders,
} from 'favalib'

// almost empty for now
const SwiftPlatformProvider = {
  CryptoLib: class {},
} as unknown as PlatformProviders

const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  SwiftPlatformProvider,
  'ios-app' as DeviceType,
  ['iphone', 'apple'],
  () => {
    /* no-op for now */
  },
)

const getPasswordStrength = async (password: Password) => {
  const result = await twoFaLibVaultCreationUtils.getPasswordStrength(password)
  return result.score
}

// example usage
console.log(await getPasswordStrength('welcome123' as Password))
