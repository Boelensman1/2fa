import type { EntryMeta, TwoFaLib } from '2falib'

import type {} from './types/Action'
import Action from './types/Action'
import State from './types/State'

export const types = {
  SET_ENTRIES: 'SET_ENTRIES' as const,
  SET_AUTHENTICATED: 'SET_AUTHENTICATED' as const,
  INITIALIZE: 'INITIALIZE' as const,
  SET_SETTINGS: 'SET_SETTINGS' as const,
}

const actions = {
  setEntries: (entries: EntryMeta[]): Action => ({
    type: types.SET_ENTRIES,
    payload: entries,
  }),
  setAuthenticated: (authenticated: boolean): Action => ({
    type: types.SET_AUTHENTICATED,
    payload: authenticated,
  }),
  initialize: (twoFaLib: TwoFaLib | null, isConnecting?: boolean): Action => ({
    type: types.INITIALIZE,
    payload: twoFaLib
      ? {
          twoFaLib,
          isConnecting: !!isConnecting,
        }
      : null,
  }),
  setSettings: (settings: State['settings']): Action => {
    // Update localStorage
    localStorage.setItem('settings', JSON.stringify(settings))

    return {
      type: types.SET_SETTINGS,
      payload: settings,
    }
  },
}

export default actions
