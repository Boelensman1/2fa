import { browser } from 'wxt/browser'
import type {
  CtActionObject,
  DetectOtpFieldsCTActionObject,
  DetectOtpFieldsResponse,
  EventNotificationCTActionObject,
  CTEvent,
} from '../types'

export const CT_ACTION_KEYS = {
  EVENT_NOTIFICATION: 'EVENT_NOTIFICATION' as const,
  DETECT_OTP_FIELDS: 'DETECT_OTP_FIELDS' as const,
}

type TabIdOpt = number | undefined

const send = async <T extends CtActionObject, U = null>(
  tabId: TabIdOpt,
  arg: T,
): Promise<U | null> => {
  if (typeof tabId === 'number') {
    try {
      // seperate, otherwise we can't catch the exception
      const result = (await browser.tabs.sendMessage(tabId, arg)) as U | null
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
  detectOtpFields: (tabId: TabIdOpt, inputSelectors: string[]) =>
    send<DetectOtpFieldsCTActionObject, DetectOtpFieldsResponse>(tabId, {
      type: CT_ACTION_KEYS.DETECT_OTP_FIELDS,
      data: { inputSelectors },
    }),
}

export default actions
