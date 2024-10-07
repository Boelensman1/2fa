import type { types } from '../actions'
import type { TwoFaLib, EntryMeta } from '2falib'

interface SetEntriesAction {
  type: typeof types.SET_ENTRIES
  payload: EntryMeta[]
}

interface SetAuthenticatedAction {
  type: typeof types.SET_AUTHENTICATED
  payload: boolean
}

interface SetConnectingToExistingVault {
  type: typeof types.SET_CONNECTING_TO_EXISTING_VAULT
  payload: boolean
}

interface InitializeAction {
  type: typeof types.INITIALIZE
  payload: null | {
    twoFaLib: TwoFaLib
  }
}

interface SetSettingsAction {
  type: typeof types.SET_SETTINGS
  payload: {
    maskEntries: boolean
  }
}

type Action =
  | SetConnectingToExistingVault
  | SetEntriesAction
  | SetAuthenticatedAction
  | InitializeAction
  | SetSettingsAction

export default Action
