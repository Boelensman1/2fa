import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { load, handleMessage } from '@/lib/content'
import type { CtActionObject } from '@/lib/types'

export default defineContentScript({
  matches: ['<all_urls>'],
  // Hosted second-factor widgets live in iframes, and a large share of those
  // are cross-origin -- which no amount of contentDocument reach-in reaches.
  // Letting every frame run its own detector and report under its own frameId
  // covers them, and needs no new permission: a statically declared content
  // script takes its host access from `matches`.
  allFrames: true,
  main(ctx) {
    load(ctx)

    // sendResponse + `return true` rather than returning the promise.
    // `@wxt-dev/browser` resolves to `chrome` on chromium, and chrome's
    // onMessage ignores a returned promise and closes the channel -- which
    // would make every fill look like it silently failed.
    browser.runtime.onMessage.addListener(
      (
        message: CtActionObject,
        _sender,
        sendResponse: (response?: unknown) => void,
      ) => {
        void handleMessage(message)
          .catch(() => undefined)
          .then(sendResponse)
        return true
      },
    )
  },
})
