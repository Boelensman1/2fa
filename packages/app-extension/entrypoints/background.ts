import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { Logger } from '@/lib'
import { buildFor } from '@/lib/parameters'
import { init, handleMessageContainer } from '@/lib/background'

export default defineBackground(() => {
  const log = new Logger('background-script')
  log.info('Extension starting up.')

  // according to mozilla docs, this listener must be top level
  browser.runtime.onMessage.addListener(handleMessageContainer)

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      if (buildFor === 'firefox') {
        void browser.permissions.getAll().then((permissions) => {
          if (!permissions.origins?.includes('<all_urls>')) {
            void browser.permissions.request({ origins: ['<all_urls>'] })
          }
        })
      }
    }
  })

  // start loading
  setTimeout(() => void init(), 1)
})
