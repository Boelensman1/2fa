import State from './types/State'

const initial: State = {
  entries: [],
  twoFaLib: null,
  vaultIsUnlocked: false,
  isConnectingToExistingVault: false,
  settings: {
    maskEntries: false,
  },
}

export default initial
