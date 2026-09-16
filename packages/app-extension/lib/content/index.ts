// Imported from their own modules rather than through `../`, deliberately.
// That barrel also exports the ioc container, which now reaches VaultContainer
// and through it the whole of favalib -- node-forge, jpake and the rest. A
// content script runs in every frame of every page and needs none of it; going
// through the barrel put 2.7MB of vault code on every page load.
import Logger from '../classes/Logger'
import { bgActions, CT_ACTION_KEYS } from '../state'
import { detectOtpFields, observeOtpFields } from '../detect'
import type { DetectedOtpFieldHandle, OtpFieldObserver } from '../detect'
import type { CtActionObject, DetectOtpFieldsResponse } from '../types'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'

declare global {
  interface Window {
    favaExtLoaded?: boolean
  }
}

const log = new Logger('content-script')

/**
 * The live elements behind the fields reported to the background.
 *
 * The background is sent `DetectedOtpField`s, which are serialisable and hold
 * no dom references; this is the other half. A later step's "fill field otp-1"
 * resolves through here, which is why the report carries an id at all.
 */
const handles = new Map<string, DetectedOtpFieldHandle>()

let observer: OtpFieldObserver | null = null

const remember = (found: readonly DetectedOtpFieldHandle[]): void => {
  handles.clear()
  for (const handle of found) handles.set(handle.field.id, handle)
}

/**
 * Starts watching this frame for otp fields.
 *
 * Every frame runs its own copy -- the content script is registered with
 * `allFrames` -- and reports under its own `frameId`, which is how hosted
 * second-factor widgets in cross-origin iframes get covered without reaching
 * into anyone's `contentDocument`.
 * @param ctx - The wxt content script context, for teardown.
 */
export const load = (ctx: ContentScriptContext): void => {
  if (window.favaExtLoaded === true) {
    log.info('Already injected, not loading again.')
    return
  }
  window.favaExtLoaded = true

  observer = observeOtpFields({
    // ctx.setTimeout returns an ordinary timer id and is cleared with the
    // ordinary clearTimeout; what it adds is that the timer dies with the
    // script. Without that an extension reload leaves an orphaned observer
    // running against dead code on every open tab.
    timers: {
      setTimeout: (callback, ms) => ctx.setTimeout(callback, ms),
      clearTimeout: (id) => {
        window.clearTimeout(id)
      },
    },
    onChange: (result) => {
      remember(result.handles)
      void bgActions.reportOtpFields(
        result.handles.map((handle) => handle.field),
        result.overrideMissed,
      )
    },
  })

  // Cheap, and it is where a user revealing a field actually ends up -- which
  // covers the one case the attributeFilter deliberately gives up on, a field
  // shown purely by a class change.
  ctx.addEventListener(window, 'focusin', () => {
    observer?.rescan()
  })

  ctx.onInvalidated(() => {
    observer?.stop()
    observer = null
    handles.clear()
  })

  log.info('Watching for otp fields.')
}

/** Resolves a reported field back to its live elements. */
export const handleFor = (id: string): DetectedOtpFieldHandle | undefined =>
  handles.get(id)

export const handleMessage = (
  msg: CtActionObject,
): DetectOtpFieldsResponse | undefined => {
  if (msg.type !== CT_ACTION_KEYS.DETECT_OTP_FIELDS) return undefined

  const result = detectOtpFields({ inputSelectors: msg.data.inputSelectors })
  remember(result.handles)
  return result.handles.map((handle) => handle.field)
}
