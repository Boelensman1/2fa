import type { EntryMeta, TwoFaLib } from '2falib'

interface State {
  entries: EntryMeta[]
  vaultIsUnlocked: boolean
  twoFaLib: TwoFaLib | null
  settings: {
    maskEntries: boolean
  }
}

export default State
