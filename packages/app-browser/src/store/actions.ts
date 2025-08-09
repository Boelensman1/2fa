import type { EntryMeta, FavaLib } from 'favalib'

import type {} from './types/Action'
import Action from './types/Action'
import State from './types/State'

export const types = {
  SET_ENTRIES: 'SET_ENTRIES' as const,
  INITIALIZE: 'INITIALIZE' as const,
  SET_SETTINGS: 'SET_SETTINGS' as const,
  SET_CONNECTING_TO_EXISTING_VAULT: 'SET_CONNECTING_TO_EXISTING_VAULT' as const,
  SET_VAULT_EXISTS: 'SET_VAULT_EXISTS' as const,
}

const actions = {
  setEntries: (entries: EntryMeta[]): Action => ({
    type: types.SET_ENTRIES,
    payload: entries,
  }),
  setConnectingToExistingVault: (connecting: boolean): Action => ({
    type: types.SET_CONNECTING_TO_EXISTING_VAULT,
    payload: connecting,
  }),
  initialize: (favaLib: FavaLib): Action => ({
    type: types.INITIALIZE,
    payload: favaLib,
  }),
  setSettings: (settings: State['settings']): Action => {
    // Update localStorage
    localStorage.setItem('settings', JSON.stringify(settings))

    return {
      type: types.SET_SETTINGS,
      payload: settings,
    }
  },
  setVaultExists: (vaultExists: boolean): Action => {
    return { type: types.SET_VAULT_EXISTS, payload: vaultExists }
  },
}

export default actions
