import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'

import OtpFieldRegistry from '../../lib/ioc/entities/OtpFieldRegistry'
import type { OtpFieldReport } from '../../lib/ioc/entities/OtpFieldRegistry'

const report = (over: Partial<OtpFieldReport> = {}): OtpFieldReport => ({
  tabId: 7,
  frameId: 0,
  url: 'https://github.com/login',
  fields: [],
  overrideMissed: false,
  scannedAt: 0,
  ...over,
})

let registry: OtpFieldRegistry

beforeEach(() => {
  registry = new OtpFieldRegistry()
})

describe('records', () => {
  it('keeps one report per frame, keyed by frame and not by document', () => {
    registry.record(report({ documentId: 'd1' }))
    registry.record(report({ documentId: 'd2', url: 'https://github.com/2fa' }))

    // Overwritten, not accumulated: keying on the frame is what makes a report
    // self-invalidating when the frame navigates.
    expect(registry.forTab(7)).toHaveLength(1)
    expect(registry.forFrame(7, 0)?.documentId).toBe('d2')
  })

  it('keeps frames apart', () => {
    registry.record(report({ frameId: 0 }))
    registry.record(report({ frameId: 4, url: 'https://widget.example/' }))

    expect(registry.forFrame(7, 4)?.url).toBe('https://widget.example/')
  })

  it('has nothing for a frame that never reported', () => {
    expect(registry.forFrame(7, 9)).toBeUndefined()
  })
})

/**
 * The floor under the popup's poll.
 *
 * On a page with no otp field the registry answers "nothing known" on every
 * tick, forever, so the rescan branch is permanently live. Without this it
 * would broadcast a dom walk to every frame of the tab the user is looking at
 * twice a second for as long as the popup is open.
 */
describe('mayRescan', () => {
  it('allows the first ask and refuses an immediate second', () => {
    expect(registry.mayRescan(7, 1_000)).toBe(true)
    expect(registry.mayRescan(7, 1_100)).toBe(false)
  })

  it('allows another once the interval has passed', () => {
    registry.mayRescan(7, 1_000)

    expect(registry.mayRescan(7, 3_100)).toBe(true)
  })

  it('throttles each tab separately', () => {
    registry.mayRescan(7, 1_000)

    expect(registry.mayRescan(8, 1_000)).toBe(true)
  })
})

describe('forgetTab', () => {
  it('drops the reports and the rescan stamp together', () => {
    registry.record(report({ frameId: 0 }))
    registry.record(report({ frameId: 4 }))
    registry.record(report({ tabId: 8 }))
    registry.mayRescan(7, 1_000)

    registry.forgetTab(7)

    expect(registry.forTab(7)).toEqual([])
    expect(registry.forTab(8)).toHaveLength(1)
    // A reopened tab id must not inherit the old one's cooldown.
    expect(registry.mayRescan(7, 1_100)).toBe(true)
  })
})
