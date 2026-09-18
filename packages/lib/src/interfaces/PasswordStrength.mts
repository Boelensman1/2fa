import type { ZxcvbnResult } from '@zxcvbn-ts/core'

/**
 * What `getPasswordStrength` returns: a score out of 4, plus zxcvbn's feedback
 * about why a password scored what it did.
 *
 * Named here so a consumer can type the result without depending on
 * `@zxcvbn-ts/core` itself -- which app-cli and app-browser both had to do,
 * purely for this one type, to say what a favalib call gives back.
 */
export type PasswordStrength = ZxcvbnResult
