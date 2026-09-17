import type { FC, FormEvent } from 'react'
import { useState } from 'react'

import { bgActions } from '@/lib/state'
import { syncServerSecretPrefill, syncServerUrlPrefill } from '@/lib/parameters'
import Button from '../Button'
import PasswordField from '../PasswordField'
import TextField from '../TextField'

interface SyncServerFormProps {
  /** The server already configured, prefilled for a change rather than a first setup. */
  currentUrl: string | null
  onConfigured: () => void
  onCancel?: () => void
}

/**
 * Asks for the sync server and its shared secret, which are one setting.
 *
 * A url alone used to be enough and was baked into every vault at creation.
 * Since favalib gained the connection gate it is not: the server refuses a
 * socket that cannot prove its secret, only the user can supply that, and a
 * url without one configures nothing. `../../../../app-browser`'s
 * `SyncServerForm` asks the same two questions.
 *
 * The secret is not in the bundle and must not be. An extension bundle is as
 * readable as a served page -- unpacking a `.crx` is a `unzip` -- so a
 * compiled-in secret is one every installer holds.
 * @param props - The component props.
 * @param props.currentUrl - The configured server, if there is one.
 * @param props.onConfigured - Called once the server has accepted the secret.
 * @param props.onCancel - Called to back out; the entry point is hidden when absent.
 * @returns The sync server form.
 */
const SyncServerForm: FC<SyncServerFormProps> = ({
  currentUrl,
  onConfigured,
  onCancel,
}) => {
  const [serverUrl, setServerUrl] = useState(currentUrl ?? syncServerUrlPrefill)
  // Never prefilled from what is stored: the vault holds the secret, but
  // showing it back would put it on screen in a popup for no gain -- proving
  // it again means retyping it, which is the same as any other credential.
  const [serverSecret, setServerSecret] = useState(syncServerSecretPrefill)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    const url = serverUrl.trim()
    const secret = serverSecret.trim()
    if (!url || !secret) {
      setError('Both the server address and the secret are required.')
      return
    }

    setBusy(true)
    setError(null)
    // Resolves only once the server has accepted, so a wrong secret surfaces
    // here rather than as a connection that silently never works.
    const result = await bgActions.setSyncServer(url, secret)
    setBusy(false)

    if (result?.ok) {
      onConfigured()
      return
    }
    setError(result?.error ?? 'Could not connect to the sync server.')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void connect()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <TextField
        label="Server address"
        value={serverUrl}
        onChange={(event) => setServerUrl(event.target.value)}
        placeholder="wss://sync.example.com"
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
        hint="An absolute ws:// or wss:// url. A path will not do — the popup has no origin to resolve one against."
      />

      <PasswordField
        label="Server secret"
        value={serverSecret}
        onChange={setServerSecret}
        autoComplete="off"
        disabled={busy}
      />

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <Button type="submit" disabled={busy}>
        {busy ? 'Connecting…' : 'Connect'}
      </Button>

      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-xs text-gray-500 underline hover:text-gray-800"
        >
          Cancel
        </button>
      ) : null}
    </form>
  )
}

export default SyncServerForm
