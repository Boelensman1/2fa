import { createSignal, Show, createEffect } from 'solid-js'
import useStore from '../store/useStore'
import PasswordStrengthMeter from './PasswordStrengthMeter'
import type { Password } from 'favalib'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'
import creationUtils from '../utils/creationUtils'

const calculatePasswordStrength = async (
  password: Password,
): Promise<ZxcvbnResult> => {
  return await creationUtils.getPasswordStrength(password)
}

const Exporter = () => {
  const [state] = useStore()
  const [format, setFormat] = createSignal<'html' | 'text'>('text')
  const [password, setPassword] = createSignal<Password>('' as Password)
  const [acknowledgedWarning, setAcknowledgedWarning] = createSignal(false)
  const [passwordStrength, setPasswordStrength] =
    createSignal<ZxcvbnResult | null>(null)

  createEffect(() => {
    if (password()) {
      void calculatePasswordStrength(password()).then(setPasswordStrength)
    } else {
      setPasswordStrength(null)
    }
  })

  const handleExport = async () => {
    const { favaLib } = state
    if (!favaLib) {
      throw new Error('favaLib not loaded')
    }

    try {
      const result = await favaLib.exportImport.exportEntries(
        format(),
        password() || undefined,
        acknowledgedWarning(),
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
            onInput={(e) => setPassword(e.currentTarget.value as Password)}
            class="ml-2 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <Show when={password()}>
          <PasswordStrengthMeter
            password={password()}
            passwordStrength={passwordStrength()}
          />
        </Show>
      </div>
      <Show when={!password()}>
        <div class="mb-4">
          <label class="flex items-center text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={acknowledgedWarning()}
              onChange={(e) => setAcknowledgedWarning(e.currentTarget.checked)}
              class="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            I acknowledge that exporting without a password will result in clear
            text that can be read by anyone
          </label>
        </div>
      </Show>
      <button
        onClick={() => void handleExport()}
        disabled={
          (!password() && !acknowledgedWarning()) ||
          (password() && (passwordStrength() ?? { score: 0 })?.score < 3)
        }
        class="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Export and Download
      </button>
    </div>
  )
}

export default Exporter
