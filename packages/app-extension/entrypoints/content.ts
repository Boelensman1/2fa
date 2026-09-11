import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { load, handleMessage } from '@/lib/content'

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    load(ctx)

    browser.runtime.onMessage.addListener(handleMessage)
  },
})
