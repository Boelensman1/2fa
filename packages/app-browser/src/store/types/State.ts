import type { EntryMeta, TwoFaLib } from '2falib'

interface State {
  entries: EntryMeta[]
  vaultExists: boolean
  twoFaLib: TwoFaLib | null
  isConnectingToExistingVault: boolean
  settings: {
    maskEntries: boolean
  }
}

export default State
