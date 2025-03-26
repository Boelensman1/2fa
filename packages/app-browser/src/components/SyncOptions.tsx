import { type Component, createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'
import AddDevice from './AddDevice'
import ListSyncDevices from './ListSyncDevices'

const SyncOptions: Component = () => {
  const [state] = useStore()
  const { twoFaLib } = state

  const [showAddDevice, setShowAddDevice] = createSignal(false)
  const [showListDevices, setShowListDevices] = createSignal(false)

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
      </div>

      <Show when={showAddDevice()}>
        <AddDevice />
      </Show>

      <Show when={showListDevices()}>
        <ListSyncDevices />
      </Show>
    </div>
  )
}

export default SyncOptions
