import { createSignal, createEffect, For } from 'solid-js'
import useStore from '../store/useStore'
import { PublicSyncDevice, FavaLibEvent } from 'favalib'

const ListSyncDevices = () => {
  const [state] = useStore()
  const [devices, setDevices] = createSignal<PublicSyncDevice[]>([])

  createEffect(() => {
    const { favaLib } = state
    if (favaLib) {
      const updateDevices = () => {
        const currentDevices = favaLib.sync?.getSyncDevices()
        setDevices(currentDevices ?? [])
      }

      favaLib.addEventListener(FavaLibEvent.Changed, updateDevices)
      updateDevices() // Initial load

      return () => {
        favaLib.removeEventListener(FavaLibEvent.Changed, updateDevices)
      }
    }
  })

  const handleRemove = (device: PublicSyncDevice) => {
    const { favaLib } = state
    if (!favaLib) return

    const label =
      device.deviceFriendlyName || device.deviceType || device.deviceId
    const confirmed = confirm(
      `Are you sure you want to remove the device "${label}"?`,
    )
    if (!confirmed) return

    void favaLib
      .removeSyncDevice(device.deviceId)
      .then(() => {
        // explicit refresh; the FavaLibEvent.Changed listener also covers this
        setDevices(favaLib.sync?.getSyncDevices() ?? [])
      })
      .catch((error: unknown) => {
        console.error('Failed to remove sync device:', error)
        alert('Failed to remove device. Please try again.')
      })
  }

  return (
    <div>
      <h2 class="text-xl font-semibold mb-2">Connected Devices</h2>
      <ul class="flex flex-col gap-2">
        <For each={devices()}>
          {(device) => (
            <li class="bg-gray-100 p-3 rounded-md flex justify-between items-center">
              <div class="flex flex-col min-w-0">
                <span class="font-medium break-words">
                  {device.deviceFriendlyName ||
                    device.deviceType ||
                    'Unknown device'}
                </span>
                <span class="text-sm text-gray-600 break-all">
                  {device.deviceId}
                  {device.deviceFriendlyName && device.deviceType
                    ? ` · ${device.deviceType}`
                    : ''}
                </span>
              </div>
              <button
                on:click={() => handleRemove(device)}
                class="text-red-600 text-sm px-3 py-1 rounded hover:bg-red-50 transition-colors shrink-0 ml-3"
              >
                Remove
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export default ListSyncDevices
