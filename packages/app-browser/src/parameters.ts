import type { DeviceType } from '2falib'

export const syncServerUrl =
  import.meta.env.VITE_SYNCSERVERURL ?? 'ws://localhost:8080'
export const deviceType = 'browser' as DeviceType
