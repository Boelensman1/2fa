import { browser } from 'wxt/browser'
import type {
  CtActionObject,
  CloseAutofillMenuCTActionObject,
  DetectOtpFieldsCTActionObject,
  DetectOtpFieldsResponse,
  EventNotificationCTActionObject,
  FillOtpFieldCTActionObject,
  FillOtpFieldResponse,
  CTEvent,
} from '../types'

export const CT_ACTION_KEYS = {
  EVENT_NOTIFICATION: 'EVENT_NOTIFICATION' as const,
  DETECT_OTP_FIELDS: 'DETECT_OTP_FIELDS' as const,
  FILL_OTP_FIELD: 'FILL_OTP_FIELD' as const,
  CLOSE_AUTOFILL_MENU: 'CLOSE_AUTOFILL_MENU' as const,
}

type TabIdOpt = number | undefined

/**
 * Which frame of a tab to deliver to.
 *
 * Omitting it broadcasts to every frame, which is right for a notification and
 * wrong for anything carrying a secret. `documentId` is preferred where the
 * browser supplies it (Chrome 106+): a frame id can be reused after a
 * navigation, a document id cannot, so it cannot deliver to a page that has
 * since been replaced. Firefox has no `documentId` and falls back to the frame.
 */
export interface FrameTarget {
  frameId?: number
  documentId?: string
}

const send = async <T extends CtActionObject, U = null>(
  tabId: TabIdOpt,
  arg: T,
  target?: FrameTarget,
): Promise<U | null> => {
  if (typeof tabId === 'number') {
    try {
      // seperate, otherwise we can't catch the exception
      const result = (await browser.tabs.sendMessage(
        tabId,
        arg,
        target?.documentId !== undefined
          ? { documentId: target.documentId }
          : target?.frameId !== undefined
            ? { frameId: target.frameId }
            : undefined,
      )) as U | null
      return result
    } catch {
      /* noop, tab is probably not listening */
    }
  }
  return null
}

const actions = {
  eventNotification: (tabId: TabIdOpt, event: CTEvent) =>
    send<EventNotificationCTActionObject>(tabId, {
      type: CT_ACTION_KEYS.EVENT_NOTIFICATION,
      data: { event },
    }),
  detectOtpFields: (
    tabId: TabIdOpt,
    inputSelectors: string[],
    target?: FrameTarget,
  ) =>
    send<DetectOtpFieldsCTActionObject, DetectOtpFieldsResponse>(
      tabId,
      {
        type: CT_ACTION_KEYS.DETECT_OTP_FIELDS,
        data: { inputSelectors },
      },
      target,
    ),
  /**
   * Hands one frame a live one-time code.
   *
   * `target` is not optional by accident -- see the type's doc comment. A
   * broadcast here would put the code in every frame on the page.
   */
  fillOtpField: (
    tabId: TabIdOpt,
    target: FrameTarget,
    data: { fieldId: string; otp: string },
  ) =>
    send<FillOtpFieldCTActionObject, FillOtpFieldResponse>(
      tabId,
      { type: CT_ACTION_KEYS.FILL_OTP_FIELD, data },
      target,
    ),
  closeAutofillMenu: (tabId: TabIdOpt, target: FrameTarget) =>
    send<CloseAutofillMenuCTActionObject>(
      tabId,
      { type: CT_ACTION_KEYS.CLOSE_AUTOFILL_MENU },
      target,
    ),
}

export default actions
