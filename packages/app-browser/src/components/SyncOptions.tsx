import { type Component, createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'
import AddDevice from './AddDevice'
import ListSyncDevices from './ListSyncDevices'
import SetDeviceNameModal from './SetDeviceNameModal'
import SyncServerForm from './SyncServerForm'

const SyncOptions: Component = () => {
  const [state] = useStore()
  const { favaLib } = state

  const [showAddDevice, setShowAddDevice] = createSignal(false)
  const [showListDevices, setShowListDevices] = createSignal(false)
  const [showSetName, setShowSetName] = createSignal(false)
  const [showServerForm, setShowServerForm] = createSignal(false)

  // Everything below needs a sync server, and a sync server needs both a url
  // and the secret it is configured with, so until those are set there is
  // nothing to add a device to.
  //
  // A signal rather than a plain `favaLib?.sync` read: nothing about favalib is
  // reactive here (see this package's AGENTS.md), and `sync` is a getter on an
  // object whose identity never changes, so the buttons would stay disabled
  // after the form succeeded. The form tells us instead.
  const [syncConfigured, setSyncConfigured] = createSignal(
    Boolean(state.favaLib?.sync),
  )

  return (
    <div>
      <div class="mt-4 flex flex-wrap gap-4">
        <button
          onClick={() => {
            setShowServerForm(!showServerForm())
          }}
          class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showServerForm() ? 'Hide Sync Server' : 'Sync Server'}
        </button>
        <button
          onClick={() => {
            const newShowAddDevice = !showAddDevice()
            setShowAddDevice(newShowAddDevice)
            if (!newShowAddDevice) {
              favaLib?.sync?.cancelAddSyncDevice()
            }
          }}
          disabled={!syncConfigured()}
          class="bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showAddDevice() ? 'Hide Add Device' : 'Show Add Device'}
        </button>
        <button
          onClick={() => {
            setShowListDevices(!showListDevices())
          }}
          disabled={!syncConfigured()}
          class="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showListDevices() ? 'Hide List Devices' : 'Show List Devices'}
        </button>
        <button
          onClick={() => {
            if (favaLib?.sync) {
              void favaLib.sync.requestResilver()
            }
          }}
          disabled={!syncConfigured()}
          class="bg-pink-500 hover:bg-pink-600 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded transition duration-200"
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

      <Show when={!syncConfigured()}>
        <p class="mt-4 text-sm text-gray-600">
          No sync server is configured, so this vault does not sync. Use
          <span class="font-semibold"> Sync Server </span>
          to set one.
        </p>
      </Show>

      <Show when={showServerForm()}>
        <SyncServerForm
          onDone={() => {
            setShowServerForm(false)
            setSyncConfigured(Boolean(state.favaLib?.sync))
          }}
        />
      </Show>

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
        deviceId {favaLib?.meta.deviceId}
      </div>
    </div>
  )
}

export default SyncOptions
