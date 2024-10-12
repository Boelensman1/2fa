import { createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'

const ConnectToExistingVault = () => {
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [textInput, setTextInput] = createSignal('')

  const handlePaste = (event: ClipboardEvent) => {
    const [state] = useStore()
    const { twoFaLib } = state
    if (!twoFaLib) {
      throw new Error('twoFaLib not loaded')
    }
    if (!twoFaLib.sync) {
      throw new Error('sync not loaded / no server connection')
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

    void twoFaLib.sync.respondToAddDeviceFlow(blob, 'qr')
  }

  const handleTextSubmit = () => {
    const [state] = useStore()
    const { twoFaLib } = state
    if (!twoFaLib?.sync) {
      setErrorMessage('Error: twoFaLib not loaded or no server connection')
      return
    }

    const text = textInput().trim()
    if (!text) {
      setErrorMessage('Please enter a valid text')
      return
    }

    setErrorMessage(null)
    void twoFaLib.sync.respondToAddDeviceFlow(text, 'text')
  }

  return (
    <div class="max-w-md mx-auto mt-8 p-6 bg-white rounded-lg shadow-md">
      <h2 class="text-2xl font-bold mb-4">Connect to Existing Vault</h2>
      <p class="mb-4">
        Paste the QR code image or enter the text to connect to an existing
        vault.
      </p>
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
  )
}

export default ConnectToExistingVault
