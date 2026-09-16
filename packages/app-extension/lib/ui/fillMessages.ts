/**
 * What to tell the user when a fill did not simply work.
 *
 * Shared by the inline menu and the popup so the same failure does not get two
 * different names, and a plain `.ts` module rather than something inside a
 * component because `vitest.config.ts` runs `tests/**\/*.test.ts` only -- a
 * `.tsx` file cannot be reached by the suite at all.
 * @module
 */

import type { FillReason } from '../types/Autofill'

const MESSAGES: Record<FillReason, string> = {
  gone: 'That field is no longer on the page.',
  'empty-code': 'Could not generate a code.',
  partial: 'Filled, but the code and the field are different lengths.',
  'no-offer': 'This menu expired. Click the field again.',
  locked: 'The vault locked. Unlock Fava and try again.',
  'unknown-entry': 'That entry is not available for this page.',
  'no-frame': 'The page changed before the code could be filled.',
  'stale-target': 'The page changed. Open the popup again.',
  // Reached only if a confirmation is somehow answered and then refused again;
  // the popup turns this reason into a question rather than a message.
  'untrusted-frame': 'That field belongs to another site.',
}

/**
 * Describes a fill that failed, including one that failed to arrive at all.
 * @param reason - What the background or the frame said, if anything.
 * @returns A sentence to put in front of the user.
 */
export const describeFillFailure = (reason?: FillReason): string =>
  reason === undefined ? 'Could not fill that field.' : MESSAGES[reason]

export default MESSAGES
