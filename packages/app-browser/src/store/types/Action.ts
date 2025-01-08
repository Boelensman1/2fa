import type { types } from '../actions'
import type { TwoFaLib, EntryMeta } from 'favalib'

interface SetEntriesAction {
  type: typeof types.SET_ENTRIES
  payload: EntryMeta[]
}

interface SetConnectingToExistingVault {
  type: typeof types.SET_CONNECTING_TO_EXISTING_VAULT
  payload: boolean
}

interface InitializeAction {
  type: typeof types.INITIALIZE
  payload: TwoFaLib
}

interface SetSettingsAction {
  type: typeof types.SET_SETTINGS
  payload: {
    maskEntries: boolean
  }
}

interface SetVaultExistsAction {
  type: typeof types.SET_VAULT_EXISTS
  payload: boolean
}

type Action =
  | SetConnectingToExistingVault
  | SetEntriesAction
  | InitializeAction
  | SetSettingsAction
  | SetVaultExistsAction

export default Action
