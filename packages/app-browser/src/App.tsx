import { type Component, createEffect } from 'solid-js'
import { Show } from 'solid-js'
import useStore from './store/useStore'
import actions from './store/actions'
import type State from './store/types/State'

import AppAuthenticated from './components/AppAuthenticated'
import Login from './components/Login'
import ConnectToExistingVault from './components/ConnectToExistingVault'
import CreateVault from './components/CreateVault'

const App: Component = () => {
  const [state, dispatch] = useStore()

  // Async function to initialize the app
  const initializeApp = () => {
    const lockedRepresentation = localStorage.getItem('lockedRepresentation')
    const settings = localStorage.getItem('settings')

    dispatch(actions.setVaultExists(Boolean(lockedRepresentation)))

    if (settings) {
      const parsedSettings = JSON.parse(settings) as State['settings']
      dispatch(actions.setSettings(parsedSettings))
    }
  }

  // Run initializeApp when the component mounts
  createEffect(() => {
    initializeApp()
  })

  return (
    <div class="container mx-auto p-4">
      <Show when={state.vaultExists} fallback={<CreateVault />}>
        <Show when={state.favaLib} fallback={<Login />}>
          <Show
            when={!state.isConnectingToExistingVault}
            fallback={<ConnectToExistingVault />}
          >
            <AppAuthenticated />
          </Show>
        </Show>
      </Show>
    </div>
  )
}

export default App
