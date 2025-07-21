import type { DeviceType } from 'favalib'

export const syncServerUrl =
  import.meta.env.VITE_SYNCSERVERURL ?? 'ws://localhost:8080'
export const deviceType = 'browser' as DeviceType

export const version = import.meta.env.VITE_COMMIT_HASH ?? 'unknown'
export const passwordExtraDict = ['browser'] as const
