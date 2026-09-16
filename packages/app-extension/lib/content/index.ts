// Imported from their own modules rather than through `../`, deliberately.
// That barrel also exports the ioc container, which now reaches VaultContainer
// and through it the whole of favalib -- node-forge, jpake and the rest. A
// content script runs in every frame of every page and needs none of it; going
// through the barrel put 2.7MB of vault code on every page load.
import Logger from '../classes/Logger'
import { bgActions, CT_ACTION_KEYS } from '../state'
import { observeOtpFields } from '../detect'
import type { DetectedOtpFieldHandle, OtpFieldObserver } from '../detect'
import { createAutofillMenu } from './autofillMenu'
import type { AutofillMenu } from './autofillMenu'
import { fillOtpField } from './fillField'
import type {
  CtActionObject,
  DetectOtpFieldsResponse,
  FillOtpFieldResponse,
} from '../types'
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
 * no dom references; this is the other half. "Fill field otp-1" resolves
 * through here, which is why the report carries an id at all.
 */
const handles = new Map<string, DetectedOtpFieldHandle>()

/**
 * Every element back to the field it belongs to.
 *
 * A segmented row is six inputs and one field, and focus lands on whichever
 * box the user clicked, so the menu needs to get from any of them to the whole.
 */
let owners = new WeakMap<Element, DetectedOtpFieldHandle>()

let observer: OtpFieldObserver | null = null
let menu: AutofillMenu | null = null

/** The overrides this frame has already scanned with, so it rescans only on a change. */
let usedInputSelectors: string[] = []

const remember = (found: readonly DetectedOtpFieldHandle[]): void => {
  handles.clear()
  owners = new WeakMap()
  for (const handle of found) {
    handles.set(handle.field.id, handle)
    for (const element of handle.elements) owners.set(element, handle)
  }
}

const sameSelectors = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

/**
 * Sends a report and applies whatever the background sends back.
 *
 * The response carries the `inputSelector` overrides for this frame's url.
 * They can only come from there -- knowing them means reading the vault -- and
 * until this existed the detector was never given any, so `EntryMeta.inputSelector`
 * did nothing however carefully a user set it.
 * @param result - The scan to report.
 */
const report = async (result: {
  handles: readonly DetectedOtpFieldHandle[]
  overrideMissed: boolean
}): Promise<void> => {
  let selectors: string[] = []
  try {
    const response = await bgActions.reportOtpFields(
      result.handles.map((handle) => handle.field),
      result.overrideMissed,
      usedInputSelectors,
    )
    selectors = response?.inputSelectors ?? []
  } catch {
    // The background may be mid-restart, or the extension may have been
    // reloaded out from under this frame. Either way there is nothing to do
    // but leave the overrides as they are and report again on the next change.
    return
  }

  if (sameSelectors(selectors, usedInputSelectors)) return

  usedInputSelectors = selectors
  // Rescanning re-enters this function through onChange, but with the
  // selectors now equal it stops there rather than looping.
  observer?.setInputSelectors(selectors)
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

  menu = createAutofillMenu({
    handleForElement: (element) => owners.get(element),
  })

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
      // The handles the open menu is anchored to have just been replaced, so
      // it has to be pointed at the new one -- or closed, if the field it was
      // anchored to did not survive the rescan. Closing unconditionally, which
      // is what this did, takes the menu away again on any page that
      // re-renders while it is up.
      menu?.retarget(result.handles)
      void report(result)
    },
  })

  // Cheap, and it is where a user revealing a field actually ends up -- which
  // covers the one case the attributeFilter deliberately gives up on, a field
  // shown purely by a class change.
  ctx.addEventListener(window, 'focusin', (event) => {
    observer?.rescan()
    menu?.focused(event.target)
  })

  ctx.onInvalidated(() => {
    menu?.stop()
    menu = null
    observer?.stop()
    observer = null
    handles.clear()
    owners = new WeakMap()
  })

  log.info('Watching for otp fields.')
}

/** Resolves a reported field back to its live elements. */
export const handleFor = (id: string): DetectedOtpFieldHandle | undefined =>
  handles.get(id)

/**
 * Handles a message from the background.
 *
 * Async, and therefore answered through `sendResponse` by the caller rather
 * than by returning a promise: `@wxt-dev/browser` is a shim, not a polyfill,
 * so on Chrome this is `chrome.runtime.onMessage`, which ignores a returned
 * promise and closes the channel.
 * @param msg - The action.
 * @returns The action's response, if it has one.
 */
export const handleMessage = async (
  msg: CtActionObject,
): Promise<DetectOtpFieldsResponse | FillOtpFieldResponse | undefined> => {
  switch (msg.type) {
    case CT_ACTION_KEYS.DETECT_OTP_FIELDS: {
      // Reporting is the point, not the return value. The background asks
      // because its registry is empty -- an mv3 eviction takes it, and "load
      // the page, wait for the code, open the popup" is exactly the sequence
      // an eviction lands in the middle of -- or because it is about to
      // deliver a code here and wants this frame's browser-supplied url
      // refreshed first. So this awaits the report rather than firing it off.
      //
      // Through the observer, so the selectors and the fingerprint keep one
      // owner: a scan run beside it would leave `lastFingerprint` describing a
      // different set and could suppress a later report that mattered.
      const result = observer?.scanNow()
      if (!result) return []

      remember(result.handles)
      await report(result)
      return result.handles.map((handle) => handle.field)
    }

    case CT_ACTION_KEYS.FILL_OTP_FIELD: {
      // Never log this payload: it carries a live code, and a content script's
      // logger forwards every entry to the background whatever its level.
      const handle = handles.get(msg.data.fieldId)
      if (!handle) return { filled: false, reason: 'gone' }

      const result = await fillOtpField(handle.elements, msg.data.otp)

      // Taking the menu down removes the iframe focus is currently inside, so
      // focus would otherwise fall back to the body and the user would have to
      // click the page again before they could submit. The last box of a
      // segmented row is where typing the code by hand would have left them.
      menu?.close()
      if (result.filled) {
        // Filled from the popup the field was never focused, so this focus()
        // does fire focusin -- which is what opens the menu. Without the
        // suppression the popup would close and an offer menu would appear
        // under the field that was just filled.
        menu?.ignoreFocusOnce()
        handle.elements[handle.elements.length - 1]?.focus()
      }
      return result
    }

    case CT_ACTION_KEYS.CLOSE_AUTOFILL_MENU: {
      menu?.close()
      return undefined
    }

    case CT_ACTION_KEYS.EVENT_NOTIFICATION: {
      if (msg.data.event === 'vaultStateChanged') menu?.close()
      return undefined
    }
  }
}
