import { injectable } from 'inversify'

import type { DetectedOtpField } from '../../detect'

/** One frame's most recent report. */
export interface OtpFieldReport {
  tabId: number
  frameId: number
  /** Browser-supplied, so trustworthy, unlike anything in the payload. */
  url: string
  fields: DetectedOtpField[]
  overrideMissed: boolean
  scannedAt: number
}

const keyFor = (tabId: number, frameId: number): string =>
  `${String(tabId)}:${String(frameId)}`

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

  record(report: OtpFieldReport): void {
    this.reports.set(keyFor(report.tabId, report.frameId), report)
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
  }
}

export default OtpFieldRegistry
