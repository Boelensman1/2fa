import { type Component, createSignal, Show } from 'solid-js'
import type { ServerSecret } from 'favalib'

import useStore from '../store/useStore'
import {
  syncServerSecretPrefill,
  syncServerUrlPrefill,
  toSyncServerUrl,
} from '../parameters'

interface SyncServerFormProps {
  onDone?: () => void
}

/**
 * Asks for the sync server and its shared secret, which are one setting.
 *
 * The secret is not in the bundle and must not be: this app is served publicly,
 * so a compiled-in secret would be a secret everyone holds. The user supplies
 * it, it is stored in their vault, and it is never sent anywhere -- what crosses
 * the wire is an HMAC over a nonce the server draws. See
 * key-hierarchy-review/16-server-authentication.md.
 * @param props - The component props.
 * @param props.onDone - Called once a server has been set successfully.
 * @returns The sync server form.
 */
const SyncServerForm: Component<SyncServerFormProps> = (props) => {
  const [state] = useStore()

  const [serverUrl, setServerUrl] = createSignal(
    state.favaLib?.sync?.serverUrl ?? syncServerUrlPrefill,
  )
  const [serverSecret, setServerSecret] = createSignal(syncServerSecretPrefill)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)

  const handleConnect = () => {
    // Read through the store rather than a destructured const, so this stays
    // reactive -- the same reason the components around it do.
    const favaLib = state.favaLib
    if (!favaLib) {
      setErrorMessage('Vault not loaded.')
      return
    }

    const url = serverUrl().trim()
    const secret = serverSecret().trim()
    if (!url || !secret) {
      setErrorMessage('Both the server address and the secret are required.')
      return
    }

    // Read out here, in the handler: the promise callback below is not a
    // tracked scope, so reaching into props from inside it would go stale.
    const onDone = props.onDone

    setErrorMessage(null)
    setBusy(true)
    // setSyncServerUrl only resolves once the server has accepted the secret,
    // so a wrong one surfaces here rather than as a connection that silently
    // never works. Its message is written for the person at the keyboard.
    favaLib
      .setSyncServerUrl(toSyncServerUrl(url), secret as ServerSecret)
      .then(() => onDone?.())
      .catch((err: unknown) => {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Could not connect to the sync server.',
        )
      })
      .finally(() => setBusy(false))
  }

  return (
    <div class="mt-4 max-w-md p-4 bg-white rounded-lg shadow-md">
      <h3 class="text-lg font-semibold mb-2">Sync server</h3>
      <p class="mb-4 text-sm text-gray-600">
        Enter the address of your sync server and the secret it is configured
        with. Both are needed: the server will not accept a connection without
        the secret.
      </p>
      <input
        type="text"
        value={serverUrl()}
        onInput={(e) => setServerUrl(e.currentTarget.value)}
        placeholder="wss://sync.example.com or /api/sync"
        class="w-full p-2 border border-gray-300 rounded mb-3"
      />
      <input
        type="password"
        value={serverSecret()}
        onInput={(e) => setServerSecret(e.currentTarget.value)}
        placeholder="Server secret"
        autocomplete="off"
        class="w-full p-2 border border-gray-300 rounded mb-4"
      />
      <button
        onClick={handleConnect}
        disabled={busy()}
        class="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded transition duration-200"
      >
        {busy() ? 'Connecting…' : 'Connect'}
      </button>
      <Show when={errorMessage()}>
        <p class="text-red-500 mt-2">{errorMessage()}</p>
      </Show>
    </div>
  )
}

export default SyncServerForm
