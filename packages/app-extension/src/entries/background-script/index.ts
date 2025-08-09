import browser from 'webextension-polyfill'

import { Logger } from '../../internals'
import { buildFor } from '../../parameters'

import handleMessageContainer from './handleMessage'
import init from './init'

const log = new Logger('background-script')
log.info('Extension starting up.')

// according to mozilla docs, this listener must be top level
// @ts-expect-error we type the message, which is not in the default types
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
