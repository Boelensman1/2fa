/**
 * Detecting the otp field on a page.
 *
 * Self-contained by design: nothing in this directory imports from `lib/`'s
 * other modules or from `wxt/*`. That keeps the scoring testable as plain
 * data, keeps the extension's logging and ioc out of a hot dom path, and
 * leaves the door open to moving the directory into favalib if a second
 * client ever needs it.
 * @module
 */

export { detectOtpFields } from './detectOtpFields'
export type { DetectionOptions, DetectionResult } from './detectOtpFields'
export type {
  DetectedOtpField,
  DetectedOtpFieldHandle,
  DetectionReason,
  DetectionReasonCode,
  DetectionSource,
  OtpConfidence,
  OtpFieldKind,
} from './types'
export { observeOtpFields } from './observe'
export type { ObserveOptions, OtpFieldObserver } from './observe'
export { isPlausiblyVisible } from './visibility'
