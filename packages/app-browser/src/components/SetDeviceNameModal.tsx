import { type Component, createSignal } from 'solid-js'
import useStore from '../store/useStore'
import type { DeviceFriendlyName } from 'favalib'

interface SetDeviceNameModalProps {
  onClose: () => void
}

const SetDeviceNameModal: Component<SetDeviceNameModalProps> = (props) => {
  const [state] = useStore()
  const { favaLib } = state
  const [newName, setNewName] = createSignal(favaLib!.meta.deviceFriendlyName)

  const handleSetName = () => {
    if (favaLib?.meta && newName().trim()) {
      void favaLib.setDeviceFriendlyName(newName().trim() as DeviceFriendlyName)
      props.onClose()
    }
  }

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white p-6 rounded-lg shadow-xl z-50">
        <h3 class="text-lg font-semibold mb-4">Set Device Name</h3>
        <input
          type="text"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          placeholder="Enter device name"
          class="w-full p-2 border rounded mb-4"
        />
        <div class="flex justify-end gap-2">
          <button
            onClick={() => props.onClose()}
            class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSetName}
            class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default SetDeviceNameModal
