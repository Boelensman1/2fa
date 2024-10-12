import { createSignal } from 'solid-js'
import useStore from '../store/useStore'

const Exporter = () => {
  const [state] = useStore()
  const [format, setFormat] = createSignal<'html' | 'text'>('text')
  const [password, setPassword] = createSignal('')

  const handleExport = async () => {
    const { twoFaLib } = state
    if (!twoFaLib) {
      throw new Error('twoFaLib not loaded')
    }

    try {
      const result = await twoFaLib.exportImport.exportEntries(
        format(),
        password() || undefined,
      )

      // Create a Blob with the exported data
      const blob = new Blob([result], { type: 'text/plain' })

      // Create a download link and trigger the download
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `exported_2fa_${format()}.${format() === 'html' ? 'html' : 'txt'}`
      if (password()) {
        a.download += '.pgp'
      }
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting data:', error)
      alert('Error exporting data. Please try again.')
    }
  }

  return (
    <div class="mt-4">
      <h2 class="text-xl font-semibold mb-2">Export Items</h2>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Export Format:
          <select
            value={format()}
            onChange={(e) =>
              setFormat(e.currentTarget.value as 'html' | 'text')
            }
            class="ml-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="text">Text</option>
            <option value="html">HTML</option>
          </select>
        </label>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">
          Password (optional):
          <input
            type="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="ml-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
      <button
        onClick={() => void handleExport}
        class="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
      >
        Export and Download
      </button>
    </div>
  )
}

export default Exporter
