import browser from 'webextension-polyfill'
import type {
  CtActionObject,
  EventNotificationCTActionObject,
  CTEvent,
} from '../types'

export const CT_ACTION_KEYS = {
  EVENT_NOTIFICATION: 'EVENT_NOTIFICATION' as const,
}

type TabIdOpt = number | undefined

const send = async <T extends CtActionObject, U = null>(
  tabId: TabIdOpt,
  arg: T,
): Promise<U | null> => {
  if (typeof tabId === 'number') {
    try {
      // seperate, otherwise we can't catch the exception
      const result = await browser.tabs.sendMessage(tabId, arg)
      return result as U | null
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
}

export default actions
