import type { DeviceType } from 'favalib'

// A path is resolved against the origin serving the app, which is what lets the
// dev/preview server proxy the connection through to the sync server on the same
// port the app itself is served from. An absolute ws:// or wss:// url is used
// as-is.
const toSyncServerUrl = (value: string) =>
  value.startsWith('/')
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${value}`
    : value

export const syncServerUrl = toSyncServerUrl(
  import.meta.env.VITE_SYNCSERVERURL ?? '/api/sync',
)
export const deviceType = 'web' as DeviceType

export const version = import.meta.env.VITE_COMMIT_HASH ?? 'unknown'
export const passwordExtraDict = ['browser', 'web'] as const
