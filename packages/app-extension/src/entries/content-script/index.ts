import { Logger } from '../../internals'
import browser from 'webextension-polyfill'
import { CtActionObject } from '../../types'

declare global {
  interface Window {
    favaExtLoaded?: boolean
  }
}

const log = new Logger('content-script')

const load = () => {
  if (window.favaExtLoaded === true) {
    log.info('Fava already injected, not loading again.')
    return
  }
  window.favaExtLoaded = true
  log.info('Injected fava.')
}

load()

// @ts-expect-error we type the message, which is not in the default types
// eslint-disable-next-line @typescript-eslint/no-unused-vars
browser.runtime.onMessage.addListener((_msg: CtActionObject) => {
  /* no-op */
})
