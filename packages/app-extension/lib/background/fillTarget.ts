/**
 * Choosing, and re-checking, the field the popup offers to fill.
 *
 * Pure: reports and a target in, decisions out. No browser, no vault, no dom.
 * That is deliberate -- these three functions are where a live code is
 * pointed at a frame, and `vitest.config.ts` runs `tests/**\/*.test.ts` only,
 * so anything that stays inside `handleMessage` is verified by hand or not at
 * all.
 * @module
 */

import type { FillTarget } from '../types/Autofill'
import type { OtpFieldReport } from '../ioc/entities/OtpFieldRegistry'

/**
 * A frame's host, when it has one worth naming.
 *
 * `REPORT_OTP_FIELDS` stores `url: url ?? ''` when the browser supplied none,
 * and an extension, `about:` or `data:` frame has no origin the user could
 * recognise. Disclosure is this feature's only real control, so a frame that
 * cannot be disclosed is not offered at all.
 * @param url - The frame's url, as reported.
 * @returns The host, or null when there is nothing honest to show.
 */
const hostOf = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.host
      : null
  } catch {
    return null
  }
}

/**
 * The one field the popup offers, out of every frame's report for a tab.
 *
 * The most confident field in the most confident frame. Both sorts already
 * exist upstream -- `detectOtpFields` orders a frame's fields and `forTab`
 * orders the frames -- but the choice is made again here rather than trusted,
 * because it decides where a code will be delivered and should not depend on
 * a caller's ordering.
 *
 * Frames that reported nothing are skipped: `forTab` includes them, since a
 * report with no fields is still how `overrideMissed` reaches the debug pane.
 * @param reports - Every frame's report for one tab.
 * @returns The target, or null when the tab has nothing to fill.
 */
export const pickFillTarget = (
  reports: readonly OtpFieldReport[],
): FillTarget | null => {
  const best = [...reports]
    .filter((report) => report.fields.length > 0 && hostOf(report.url) !== null)
    .sort((a, b) => (b.fields[0]?.score ?? 0) - (a.fields[0]?.score ?? 0))[0]

  const field = best?.fields[0]
  if (!best || !field) return null

  return {
    tabId: best.tabId,
    frameId: best.frameId,
    documentId: best.documentId,
    fieldId: field.id,
    url: best.url,
    host: hostOf(best.url) ?? '',
    confidence: field.confidence,
    inSubframe: best.frameId !== 0,
  }
}

/**
 * Whether a frame still holds the field the popup was shown.
 *
 * Meant to be called on a report the frame has just been made to re-send, so
 * that "still" is true at the moment the code is minted rather than whenever
 * the registry last heard anything.
 *
 * `url` is the check that matters. The registry is keyed by frame and nothing
 * invalidates it on navigation -- `forgetTab` only runs when the tab closes --
 * and a frame id belongs to the browsing context, so a browser reuses it
 * across that frame's own navigations. Without this, a popup left open while
 * an embedded widget navigated could deliver a live code into whatever
 * replaced it.
 * @param report - The frame's current report, if it has one.
 * @param target - What the popup was shown.
 * @returns True when the two still describe the same field.
 */
export const stillHoldsTarget = (
  report: OtpFieldReport | undefined,
  target: FillTarget,
): report is OtpFieldReport =>
  report?.url === target.url &&
  report.documentId === target.documentId &&
  report.fields.some((field) => field.id === target.fieldId)

export interface FrameTrustQuestion {
  /** 0 is the tab's own document. */
  frameId: number
  /** The frame's url, from its latest report. */
  frameUrl: string
  /** The top frame's url, or null when it has not reported. */
  pageUrl: string | null
  /** Whether the entry being filled has a matcher covering `frameUrl`. */
  entryClaimsFrame: boolean
}

/** `a` is `b`, or a subdomain of it, on a dot boundary. */
const isWithin = (a: string, b: string): boolean =>
  a === b || a.endsWith(`.${b}`)

/**
 * Whether a fill into this frame can go ahead without asking.
 *
 * This is Bitwarden's rule for *manual* autofill, which is the only kind
 * anything here does: an embedded frame is untrusted when its url does not
 * match a uri saved on the item being filled, and filling an untrusted one
 * shows the url and lets the user cancel or proceed. Their published
 * behaviour only -- their autofill source is GPL-3.0 and was not read, for the
 * reason `patterns.ts` gives.
 *
 * Worth being clear about which half of the design this is. The popup offers
 * *every* entry regardless of the site, deliberately; that is the feature.
 * What this guards is the other direction: which *frame* a code may be typed
 * into without a second look. A field in the page the user navigated to is
 * fine by definition. A field in some embedded third party is not, unless the
 * entry itself vouches for that origin -- which is exactly the hosted
 * second-factor widget the inline menu's frame-url matching already serves.
 *
 * Rule 3 is narrower than Bitwarden's "same domain as the website": telling
 * `bbc.co.uk` from `co.uk` needs a public suffix list, and favalib carries
 * none on purpose (see `suggestMatchersForUrl`). Same host or a subdomain of
 * it, either direction, is what can be decided without one. Narrower means an
 * extra confirmation, never a missing one.
 * @param question - See {@link FrameTrustQuestion}.
 * @returns True when the fill may proceed unasked.
 */
export const isTrustedFrame = (question: FrameTrustQuestion): boolean => {
  const { frameId, frameUrl, pageUrl, entryClaimsFrame } = question

  // The page the user navigated to and is looking at.
  if (frameId === 0) return true

  // The entry names this origin itself.
  if (entryClaimsFrame) return true

  if (pageUrl === null) return false
  const frameHost = hostOf(frameUrl)
  const pageHost = hostOf(pageUrl)
  if (frameHost === null || pageHost === null) return false

  // Either direction: a page at `www.example.com` embedding `example.com` is
  // as much one site as the reverse, and both are the user's own.
  return isWithin(frameHost, pageHost) || isWithin(pageHost, frameHost)
}
