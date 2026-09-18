import type { FC, FormEvent } from 'react'
import { useState } from 'react'

import { bgActions } from '@/lib/state'
import { pairDraft } from '@/lib/drafts'
import { useDraft } from '../../hooks'
import Button from '../Button'
import Splash from '../Splash'
import SyncServerForm from '../SyncServerForm'
import TextField from '../TextField'

interface PairScreenProps {
  onPaired: () => void
  /** Null when no sync server has been configured yet. */
  syncServerUrl: string | null
  syncConnected: boolean
  /** Re-reads the vault summary, so a configured server changes what is rendered. */
  onSyncServerChanged: () => void
}

/**
 * Joining an existing vault.
 *
 * Text codes only. The other clients also accept a pasted qr *image*, which
 * favalib decodes through `getImageDataFromInput` -- that needs `Image`,
 * `document` and `FileReader`, none of which exist in the service worker where
 * this extension's vault lives. The text code carries exactly the same
 * payload, so nothing is lost but a convenience.
 *
 * The code comes off another device, so getting it means leaving the popup --
 * which destroys it. Both fields are drafted for that (`lib/drafts.ts`), and
 * dropped once the pairing is through. Cancelling resets the vault, and
 * `VaultContainer.lock()` clears every draft on the way.
 */
const PairScreen: FC<PairScreenProps> = ({
  onPaired,
  syncServerUrl,
  syncConnected,
  onSyncServerChanged,
}) => {
  const [draft, setDraft, { ready, clear }] = useDraft(pairDraft, {
    connectionString: '',
    deviceName: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pair = async () => {
    setBusy(true)
    setError(null)
    const result = await bgActions.pairDevice(
      draft.connectionString.trim(),
      draft.deviceName.trim() || undefined,
    )
    setBusy(false)

    if (result?.ok) {
      clear()
      onPaired()
      return
    }
    setError(result?.error ?? 'Could not pair with that device')
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void pair()
  }

  const onCancel = () => {
    if (!confirm('Cancel pairing and forget the vault created on this device?'))
      return
    void bgActions.resetVault().then(onPaired)
  }

  // Nothing may render before the draft read lands: a field that takes a
  // keystroke in that gap has it overwritten by hydration.
  if (!ready) return <Splash />

  // Pairing is a conversation over the sync server, so there is nothing to do
  // here until one is configured. It is a step rather than a build-time
  // setting because the server will not accept a socket without its shared
  // secret, and only the user has that -- see `SyncServerForm`.
  if (syncServerUrl === null) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <header>
          <h1 className="text-lg font-semibold text-gray-900">
            Set up your sync server
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            Joining an existing vault happens over your sync server, so it has
            to be set up first. Use the same address and secret as the device
            you are joining from.
          </p>
        </header>

        <SyncServerForm
          currentUrl={null}
          onConfigured={onSyncServerChanged}
          onCancel={onCancel}
        />
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
      <header>
        <h1 className="text-lg font-semibold text-gray-900">
          Connect to your vault
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          On a device that already has your vault, open{' '}
          <span className="font-medium">Sync options → Add device</span> (or run{' '}
          <code className="rounded bg-gray-100 px-1">favacli sync connect</code>
          ) and paste the text code here.
        </p>
      </header>

      {!syncConnected ? (
        <p className="rounded-md bg-yellow-50 p-2 text-xs text-yellow-800">
          Not connected to the sync server yet. Pairing needs that connection —
          check that the server is reachable.
        </p>
      ) : null}

      <TextField
        label="Device name (optional)"
        value={draft.deviceName}
        onChange={(event) =>
          setDraft({ ...draft, deviceName: event.target.value })
        }
        placeholder="Work laptop"
        disabled={busy}
      />

      <div>
        <label
          htmlFor="connection-code"
          className="mb-1 block text-xs font-medium text-gray-700"
        >
          Connection code
        </label>
        <textarea
          id="connection-code"
          value={draft.connectionString}
          onChange={(event) =>
            setDraft({ ...draft, connectionString: event.target.value })
          }
          rows={4}
          disabled={busy}
          className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 font-mono text-xs break-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
        />
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <Button
        type="submit"
        disabled={busy || draft.connectionString.trim().length === 0}
      >
        {busy ? 'Connecting…' : 'Connect'}
      </Button>

      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-gray-500 underline hover:text-gray-800"
      >
        Cancel
      </button>
    </form>
  )
}

export default PairScreen
