import {
  AuthenticatedApp,
  CreateVaultScreen,
  PairScreen,
  Splash,
  UnlockScreen,
} from '@/lib/ui/components'
import { useVault } from '@/lib/ui/hooks'

/**
 * The popup.
 *
 * A switch on where the vault is, the way `../app-browser`'s App gates with
 * nested `<Show>`. The vault itself lives in the background service worker --
 * this holds no keys and no entries, only what the background last told it.
 *
 * `summary === null` is "the background has not answered yet", which is not
 * the same as "there is no vault"; rendering the create screen in that gap
 * would flash first-run onboarding at someone who is merely locked.
 */
const Popup = () => {
  const { summary, refresh } = useVault()

  if (!summary) return <Splash />

  switch (summary.status) {
    case 'no-vault':
      return <CreateVaultScreen onCreated={() => void refresh()} />
    case 'pairing':
      return (
        <PairScreen
          syncConnected={summary.syncConnected}
          onPaired={() => void refresh()}
        />
      )
    case 'locked':
      return <UnlockScreen onUnlocked={() => void refresh()} />
    case 'unlocked':
      return (
        <AuthenticatedApp
          summary={summary}
          onVaultChanged={() => void refresh()}
        />
      )
  }
}

export default Popup
