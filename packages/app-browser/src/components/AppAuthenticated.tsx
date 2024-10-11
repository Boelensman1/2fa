import { type Component, createSignal, Show } from 'solid-js'
import useStore from '../store/useStore'
import Add from './Add'
import ItemList from './ItemList'
import Importer from './Importer'
import Exporter from './Exporter'
import Settings from './Settings'
import AddDevice from './AddDevice'

const AppAuthenticated: Component = () => {
  const [state] = useStore()
  const { twoFaLib } = state
  const [showAdd, setShowAdd] = createSignal(false)
  const [showImporter, setShowImporter] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [showAddDevice, setShowAddDevice] = createSignal(false)
  const [showExporter, setShowExporter] = createSignal(false)

  return (
    <div class="container mx-auto p-4">
      <ItemList />

      <div class="mt-4 flex flex-wrap gap-4">
        <button
          onClick={() => setShowAdd(!showAdd())}
          class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showAdd() ? 'Hide Add' : 'Show Add'}
        </button>
        <button
          onClick={() => setShowImporter(!showImporter())}
          class="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showImporter() ? 'Hide Importer' : 'Show Importer'}
        </button>
        <button
          onClick={() => setShowExporter(!showExporter())}
          class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showExporter() ? 'Hide Exporter' : 'Show Exporter'}
        </button>
        <button
          onClick={() => setShowSettings(!showSettings())}
          class="bg-purple-500 hover:bg-purple-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showSettings() ? 'Hide Settings' : 'Show Settings'}
        </button>
        <button
          onClick={() => {
            const newShowAddDevice = !showAddDevice()
            setShowAddDevice(newShowAddDevice)
            if (!newShowAddDevice) {
              twoFaLib?.sync?.cancelAddSyncDevice()
            }
          }}
          class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showAddDevice() ? 'Hide Add Device' : 'Show Add Device'}
        </button>
      </div>

      <Show when={showAdd()}>
        <Add />
      </Show>

      <Show when={showImporter()}>
        <Importer />
      </Show>

      <Show when={showExporter()}>
        <Exporter />
      </Show>

      <Show when={showSettings()}>
        <Settings />
      </Show>

      <Show when={showAddDevice()}>
        <AddDevice />
      </Show>
    </div>
  )
}

export default AppAuthenticated
