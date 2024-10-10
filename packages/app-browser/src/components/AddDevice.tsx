import { createSignal, onMount } from 'solid-js'
import useStore from '../store/useStore'

const AddDevice = () => {
  const [state] = useStore()
  const [qrCodeData, setQrCodeData] = createSignal('')
  const [textData, setTextData] = createSignal('')
  const [error, setError] = createSignal('')

  const createQr = async () => {
    try {
      const { twoFaLib } = state
      if (!twoFaLib) {
        throw new Error('twoFaLib not loaded')
      }
      if (!twoFaLib.sync) {
        throw new Error('sync not loaded / no server connection')
      }

      const result = await twoFaLib.sync.initiateAddDeviceFlow({
        qr: true,
        text: true,
      })
      setQrCodeData(result.qr)
      setTextData(result.text)
    } catch (err) {
      setError('Failed to generate QR code')
      console.error(err)
    }
  }

  onMount(() => {
    void createQr()
  })

  return (
    <div class="mt-4">
      <h2 class="text-xl font-semibold mb-2">Add Device</h2>
      {error() ? (
        <p class="text-red-500">{error()}</p>
      ) : qrCodeData() ? (
        <div>
          <p class="mb-2">Scan this QR code with your new device:</p>
          <img
            src={qrCodeData()}
            alt="QR Code for adding device"
            class="mx-auto"
          />
          <div class="mt-4">
            <p class="mb-2">Or enter this code manually:</p>
            <pre class="bg-gray-100 p-2 rounded-md overflow-x-auto">
              {textData()}
            </pre>
          </div>
        </div>
      ) : (
        <div class="loader mx-auto" />
      )}
    </div>
  )
}

export default AddDevice
