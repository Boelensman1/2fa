import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'
import { Logger } from '@/lib'
import { init, handleMessageContainer } from '@/lib/background'

export default defineBackground(() => {
  const log = new Logger('background-script')
  log.info('Extension starting up.')

  // according to mozilla docs, this listener must be top level
  browser.runtime.onMessage.addListener(handleMessageContainer)

  // There used to be an `onInstalled` handler here, inherited from the
  // starter, that asked for `<all_urls>` on Firefox. It could never succeed:
  // `permissions.request` may only be called from a user input handler, and
  // `onInstalled` is not one -- every install logged "permissions.request may
  // only be called from a user input handler". It would have been rejected a
  // second time anyway, because a permission has to be declared in
  // `optional_permissions` (mv2) / `optional_host_permissions` (mv3) to be
  // requestable at all, and this manifest declares neither.
  //
  // Nothing is missing without it. wxt builds Firefox as mv2, where the
  // statically declared content script takes its host access from
  // `matches: ['<all_urls>']` and is granted it at install time. If this ever
  // moves to Firefox mv3, host access does become opt-in and would need a
  // real request -- from a click in the popup, not from here.

  // start loading
  setTimeout(() => void init(), 1)
})
