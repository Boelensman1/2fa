import { type Component, createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'
import AddDevice from './AddDevice'
import ListSyncDevices from './ListSyncDevices'
import SetDeviceNameModal from './SetDeviceNameModal'

const SyncOptions: Component = () => {
  const [state] = useStore()
  const { twoFaLib } = state

  const [showAddDevice, setShowAddDevice] = createSignal(false)
  const [showListDevices, setShowListDevices] = createSignal(false)
  const [showSetName, setShowSetName] = createSignal(false)

  return (
    <div>
      <div class="mt-4 flex flex-wrap gap-4">
        <button
          onClick={() => {
            const newShowAddDevice = !showAddDevice()
            setShowAddDevice(newShowAddDevice)
            if (!newShowAddDevice) {
              twoFaLib?.sync?.cancelAddSyncDevice()
            }
          }}
          class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showAddDevice() ? 'Hide Add Device' : 'Show Add Device'}
        </button>
        <button
          onClick={() => {
            setShowListDevices(!showListDevices())
          }}
          class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showListDevices() ? 'Hide List Devices' : 'Show List Devices'}
        </button>
        <button
          onClick={() => {
            if (twoFaLib?.sync) {
              void twoFaLib.sync.requestResilver()
            }
          }}
          class="bg-pink-500 hover:bg-pink-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          Resilver
        </button>
        <button
          onClick={() => setShowSetName(true)}
          class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          Set Device Name
        </button>
      </div>

      <Show when={showAddDevice()}>
        <AddDevice />
      </Show>

      <Show when={showListDevices()}>
        <ListSyncDevices />
      </Show>

      <Show when={showSetName()}>
        <SetDeviceNameModal onClose={() => setShowSetName(false)} />
      </Show>

      <div class="fixed bottom-2 right-2 text-xs text-gray-500">
        deviceId {twoFaLib?.meta.deviceId}
      </div>
    </div>
  )
}

export default SyncOptions
