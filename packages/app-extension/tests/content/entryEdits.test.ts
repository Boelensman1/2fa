import { describe, expect, it, vi } from 'vitest'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))
const scanNow = vi.fn(() => ({ handles: [], overrideMissed: false }))
const setInputSelectors = vi.fn()
const closeMenu = vi.fn()
const reportOtpFields = vi.fn()
vi.mock('../../lib/detect', () => ({
  observeOtpFields: () => ({ scanNow, setInputSelectors, stop: vi.fn() }),
}))
vi.mock('../../lib/content/autofillMenu', () => ({
  createAutofillMenu: () => ({ close: closeMenu, stop: vi.fn() }),
}))
vi.mock('../../lib/content/rememberPrompt', () => ({
  createRememberPrompt: () => ({ stop: vi.fn() }),
}))
vi.mock('../../lib/state', () => ({
  bgActions: {
    sendLog: vi.fn(),
    reportOtpFields: (...args: unknown[]) =>
      reportOtpFields(...args) as unknown,
  },
  CT_ACTION_KEYS: {
    EVENT_NOTIFICATION: 'EVENT_NOTIFICATION',
    DETECT_OTP_FIELDS: 'DETECT_OTP_FIELDS',
  },
}))

const { load, handleMessage } = await import('../../lib/content')

describe('entry edit notifications', () => {
  it('closes old menus and explicitly reports unchanged fields to refresh and remove selectors', async () => {
    let stop!: () => void
    const ctx = {
      addEventListener: vi.fn(),
      onInvalidated: (callback: () => void) => {
        stop = callback
      },
    } as unknown as ContentScriptContext
    reportOtpFields.mockResolvedValue({ inputSelectors: ['#new-otp'] })
    load(ctx)
    try {
      await handleMessage({
        type: 'EVENT_NOTIFICATION',
        data: { event: 'entriesChanged' },
      })
      expect(closeMenu).toHaveBeenCalledOnce()
      expect(scanNow).toHaveBeenCalledOnce()
      expect(reportOtpFields).toHaveBeenCalledWith([], false, [])
      expect(setInputSelectors).toHaveBeenLastCalledWith(['#new-otp'])

      reportOtpFields.mockResolvedValue({ inputSelectors: [] })
      await handleMessage({
        type: 'EVENT_NOTIFICATION',
        data: { event: 'entriesChanged' },
      })
      expect(scanNow).toHaveBeenCalledTimes(2)
      expect(reportOtpFields).toHaveBeenLastCalledWith([], false, ['#new-otp'])
      expect(setInputSelectors).toHaveBeenLastCalledWith([])
    } finally {
      stop()
      delete window.favaExtLoaded
    }
  })
})
