import { injectable } from 'inversify'

import type { DetectedOtpField } from '../../detect'

/** One frame's most recent report. */
export interface OtpFieldReport {
  tabId: number
  frameId: number
  /**
   * Chrome's per-document id for that frame (106+), absent on Firefox mv2.
   *
   * Recorded as data, never folded into the key: keying on the frame is what
   * makes a report self-invalidating, because a navigated frame reports again
   * under the same key and overwrites. Keyed by document, a navigated frame
   * would leave a record nothing ever replaces.
   */
  documentId?: string
  /** Browser-supplied, so trustworthy, unlike anything in the payload. */
  url: string
  fields: DetectedOtpField[]
  overrideMissed: boolean
  scannedAt: number
}

const keyFor = (tabId: number, frameId: number): string =>
  `${String(tabId)}:${String(frameId)}`

/**
 * However often the popup asks, a tab is not made to rescan more than this.
 *
 * The popup polls for a fill target, and on a page with no otp field on it --
 * nearly every page -- the answer is "nothing known" on every tick, forever.
 * Without a floor, that broadcasts a dom walk to every frame of the tab the
 * user is looking at twice a second for as long as the popup is open.
 */
const RESCAN_MIN_INTERVAL_MS = 2000

/**
 * The latest otp-field report from every frame.
 *
 * In memory only. An mv3 service worker is killed whenever the browser feels
 * like it, and losing this costs a rescan and nothing else -- persisting it
 * would only mean acting on a report about a page that has since navigated.
 */
@injectable()
class OtpFieldRegistry {
  private reports = new Map<string, OtpFieldReport>()

  private lastRescan = new Map<number, number>()

  record(report: OtpFieldReport): void {
    this.reports.set(keyFor(report.tabId, report.frameId), report)
  }

  /** One frame's report, for a caller that already knows which frame it wants. */
  forFrame(tabId: number, frameId: number): OtpFieldReport | undefined {
    return this.reports.get(keyFor(tabId, frameId))
  }

  /**
   * Whether this tab may be asked to rescan now, stamping it if so.
   *
   * Discovery is best-effort and therefore throttled; correctness is not, and
   * is enforced at fill time by making the frame report again before a code is
   * generated. That split is why a throttled and occasionally stale answer
   * here is safe.
   * @param tabId - The tab about to be asked.
   * @param now - Injectable so the suite does not have to wait two seconds.
   * @returns True when the caller should go ahead.
   */
  mayRescan(tabId: number, now = Date.now()): boolean {
    const last = this.lastRescan.get(tabId)
    // Explicitly "never asked" rather than a zero default: the difference only
    // shows up for a small `now`, which is every test that injects one.
    if (last !== undefined && now - last < RESCAN_MIN_INTERVAL_MS) {
      return false
    }
    this.lastRescan.set(tabId, now)
    return true
  }

  /** Every frame's report for one tab, most confident frame first. */
  forTab(tabId: number): OtpFieldReport[] {
    return [...this.reports.values()]
      .filter((report) => report.tabId === tabId)
      .sort((a, b) => (b.fields[0]?.score ?? 0) - (a.fields[0]?.score ?? 0))
  }

  forgetTab(tabId: number): void {
    for (const [key, report] of this.reports) {
      if (report.tabId === tabId) this.reports.delete(key)
    }
    this.lastRescan.delete(tabId)
  }
}

export default OtpFieldRegistry
