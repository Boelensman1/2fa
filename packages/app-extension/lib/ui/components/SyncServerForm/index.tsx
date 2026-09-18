import type { FC, FormEvent } from 'react'
import { useState } from 'react'

import { bgActions } from '@/lib/state'
import { syncServerDraft } from '@/lib/drafts'
import { syncServerSecretPrefill, syncServerUrlPrefill } from '@/lib/parameters'
import { useDraft } from '../../hooks'
import Button from '../Button'
import PasswordField from '../PasswordField'
import Splash from '../Splash'
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
 *
 * Both fields are drafted (`lib/drafts.ts`), because this is the screen the
 * popup's disappearing act hurts most: two long strings that live somewhere
 * else, and going to fetch either one closes the popup. The draft is dropped
 * the moment the form is left -- here on connect and on cancel, and by
 * `SettingsTab`/`AuthenticatedApp` when the editor is closed another way.
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
  // Never prefilled from what is stored: the vault holds the secret, but
  // showing it back would put it on screen in a popup for no gain -- proving
  // it again means retyping it, which is the same as any other credential. A
  // draft is not that; it is what the user typed a moment ago and has not
  // finished with.
  const [draft, setDraft, { ready, clear }] = useDraft(syncServerDraft, {
    url: currentUrl ?? syncServerUrlPrefill,
    secret: syncServerSecretPrefill,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    const url = draft.url.trim()
    const secret = draft.secret.trim()
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
      // Used, and therefore done with: the server that accepted it has it
      // stored in the vault, and nothing here needs it again.
      clear()
      onConfigured()
      return
    }
    setError(result?.error ?? 'Could not connect to the sync server.')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void connect()
  }

  const cancel = () => {
    clear()
    onCancel?.()
  }

  if (!ready) return <Splash />

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <TextField
        label="Server address"
        value={draft.url}
        onChange={(event) => setDraft({ ...draft, url: event.target.value })}
        placeholder="wss://sync.example.com"
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
        hint="An absolute ws:// or wss:// url. A path will not do — the popup has no origin to resolve one against."
      />

      <PasswordField
        label="Server secret"
        value={draft.secret}
        onChange={(secret) => setDraft({ ...draft, secret })}
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
          onClick={cancel}
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
