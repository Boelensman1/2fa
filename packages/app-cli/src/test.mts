import {
  DeviceType,
  getFavaLibVaultCreationUtils,
  Password,
  PlatformProviders,
} from 'favalib'

// almost empty for now
const SwiftPlatformProvider = {
  CryptoLib: class {},
} as unknown as PlatformProviders

const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
  SwiftPlatformProvider,
  'ios-app' as DeviceType,
  ['iphone', 'apple'],
  () => {
    /* no-op for now */
  },
)

const getPasswordStrength = async (password: Password) => {
  const result = await favaLibVaultCreationUtils.getPasswordStrength(password)
  return result.score
}

// example usage
console.log(await getPasswordStrength('welcome123' as Password))
