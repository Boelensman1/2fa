import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { load, handleMessage } from '@/lib/content'

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

    browser.runtime.onMessage.addListener(handleMessage)
  },
})
