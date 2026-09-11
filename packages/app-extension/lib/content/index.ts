import { Logger } from '../'
import type { CtActionObject } from '../types'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'

declare global {
  interface Window {
    baseExtLoaded?: boolean
  }
}

const log = new Logger('content-script')

export const load = (_ctx: ContentScriptContext) => {
  if (window.baseExtLoaded === true) {
    log.info('Browser ai already injected, not loading again.')
    return
  }
  window.baseExtLoaded = true
  log.info('Injected base ext.')
}

export const handleMessage = (_msg: CtActionObject) => {
  /* no-op */
}
