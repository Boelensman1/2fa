import { type Component, createSignal, Show } from 'solid-js'
import Add from './Add'
import ItemList from './ItemList'
import Importer from './Importer'
import Exporter from './Exporter'
import Settings from './Settings'
import SyncOptions from './SyncOptions'

const AppAuthenticated: Component = () => {
  const [showAdd, setShowAdd] = createSignal(false)
  const [showImporter, setShowImporter] = createSignal(false)
  const [showSettings, setShowSettings] = createSignal(false)
  const [showExporter, setShowExporter] = createSignal(false)
  const [showSyncOptions, setShowSyncOptions] = createSignal(false)

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
          onClick={() => setShowSyncOptions(!showSyncOptions())}
          class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded transition duration-200"
        >
          {showSyncOptions() ? 'Hide Sync Options' : 'Show Sync Options'}
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

      <Show when={showSyncOptions()}>
        <SyncOptions />
      </Show>
    </div>
  )
}

export default AppAuthenticated
