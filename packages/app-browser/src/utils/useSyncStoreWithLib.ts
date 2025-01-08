import { useContext } from 'solid-js'
import context from '../store/Context'
import actions from '../store/actions'
import type { TwoFaLib } from 'favalib'

const useSyncStoreWithLib = () => {
  const [, dispatch] = useContext(context)

  const syncStoreWithLib = (twoFaLib: TwoFaLib) => {
    dispatch(actions.setEntries(twoFaLib.vault.listEntriesMetas()))
  }

  return syncStoreWithLib
}

export default useSyncStoreWithLib
