import type { CT_ACTION_KEYS } from '../internals'

export type CTEvent = 'configUpdated'
export interface EventNotificationCTActionObject {
  type: typeof CT_ACTION_KEYS.EVENT_NOTIFICATION
  data: { event: CTEvent }
}

export type CtActionObject = EventNotificationCTActionObject
