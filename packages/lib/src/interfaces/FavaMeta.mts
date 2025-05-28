import type { DeviceFriendlyName, DeviceId } from './SyncTypes.mjs'

export interface FavaMeta {
  deviceId: DeviceId
  deviceFriendlyName?: DeviceFriendlyName
}
