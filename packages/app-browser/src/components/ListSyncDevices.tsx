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

  return (
    <div>
      <h2 class="text-xl font-semibold mb-2">Connected Devices</h2>
      <ul>
        <For each={devices()}>
          {(device) => (
            <li>
              {device.deviceId} {device.deviceType} {device.deviceFriendlyName}
            </li>
          )}
        </For>
      </ul>
    </div>
  )
}

export default ListSyncDevices
