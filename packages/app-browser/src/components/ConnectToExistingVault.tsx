import { createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'
import type { DeviceFriendlyName } from 'favalib'
import SyncServerForm from './SyncServerForm'

const ConnectToExistingVault = () => {
  const [store] = useStore()
  // Not a `store.favaLib?.sync` read in the Show below: `sync` is a getter on an
  // object the store hands out by reference, so becoming non-null notifies
  // nobody. The form says when it has succeeded.
  const [syncConfigured, setSyncConfigured] = createSignal(
    Boolean(store.favaLib?.sync),
  )
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [textInput, setTextInput] = createSignal('')
  const [deviceName, setDeviceName] = createSignal('')

  const respondWithName = async (data: string | File, type: 'text' | 'qr') => {
    const [state] = useStore()
    const { favaLib } = state
    if (!favaLib?.sync) {
      throw new Error('favaLib not loaded / no server connection')
    }

    const name = deviceName().trim()
    if (name) {
      await favaLib.setDeviceFriendlyName(name as DeviceFriendlyName)
    }
    await favaLib.sync.respondToAddDeviceFlow(data, type)
  }

  // Every way this can fail -- an unreadable QR code, a malformed connection
  // string, a device on a pairing version this build cannot exchange keys with
  // -- arrives as a rejection here. favalib writes those messages for the
  // person holding the two devices, so show them rather than a generic one.
  const reportFailure = (err: unknown) => {
    setErrorMessage(
      err instanceof Error ? err.message : 'Could not connect to the vault.',
    )
  }

  const handlePaste = (event: ClipboardEvent) => {
    const [state] = useStore()
    const { favaLib } = state
    if (!favaLib?.sync) {
      setErrorMessage('Error: favaLib not loaded or no server connection')
      return
    }

    const items = event.clipboardData?.items
    if (!items) {
      setErrorMessage('No items found in clipboard.')
      return
    }

    if (items.length > 1) {
      setErrorMessage('Please paste only one image at a time.')
      return
    }

    setErrorMessage(null)

    const [item] = items
    if (!item.type.startsWith('image')) {
      setErrorMessage('Pasted content is not an image.')
      return
    }

    const blob = item.getAsFile()
    if (!blob) {
      setErrorMessage('Failed to get image file from clipboard.')
      return
    }

    respondWithName(blob, 'qr').catch(reportFailure)
  }

  const handleTextSubmit = () => {
    const [state] = useStore()
    const { favaLib } = state
    if (!favaLib?.sync) {
      setErrorMessage('Error: favaLib not loaded or no server connection')
      return
    }

    const text = textInput().trim()
    if (!text) {
      setErrorMessage('Please enter a valid text')
      return
    }

    setErrorMessage(null)
    respondWithName(text, 'text').catch(reportFailure)
  }

  // Pairing runs entirely through the sync server, so there is no point asking
  // for a connection string before there is a server to exchange it over. Ask
  // for the server and its secret first; this used to be an error message
  // telling the user about a connection they had no way to configure.
  return (
    <Show
      when={syncConfigured()}
      fallback={
        <div class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
          <h2 class="text-2xl font-bold mb-2">Connect to Existing Vault</h2>
          <p class="mb-2">
            Connecting to another device goes through a sync server. Set one up
            first.
          </p>
          <SyncServerForm onDone={() => setSyncConfigured(true)} />
        </div>
      }
    >
      <div class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
        <h2 class="text-2xl font-bold mb-4">Connect to Existing Vault</h2>
        <p class="mb-4">
          Paste the QR code image or enter the text to connect to an existing
          vault.
        </p>
        <div class="mb-4">
          <input
            type="text"
            value={deviceName()}
            onInput={(e) => setDeviceName(e.currentTarget.value)}
            placeholder="Device name (optional)"
            class="w-full p-2 border border-gray-300 rounded"
          />
        </div>
        <div
          class="border-2 border-dashed border-gray-300 p-8 text-center cursor-pointer mb-4"
          onPaste={handlePaste}
          tabIndex={0}
        >
          <p>Click here and paste your image (Ctrl+V)</p>
        </div>
        <div class="mb-4">
          <input
            type="text"
            value={textInput()}
            onInput={(e) => setTextInput(e.currentTarget.value)}
            placeholder="Or enter text here"
            class="w-full p-2 border border-gray-300 rounded"
          />
        </div>
        <button
          onClick={handleTextSubmit}
          class="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          Submit Text
        </button>
        <Show when={errorMessage()}>
          <p class="text-red-500 mt-2">{errorMessage()}</p>
        </Show>
      </div>
    </Show>
  )
}

export default ConnectToExistingVault
