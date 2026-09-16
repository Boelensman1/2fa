import type { DeviceType } from 'favalib'

import pkg from '../package.json'

export const defaultLanguage = 'en'
export const version = pkg.version

export const buildFor = String(import.meta.env.BROWSER ?? 'chrome')

/**
 * Where the sync server lives.
 *
 * `../app-browser` can default this to the path `/api/sync` and resolve it
 * against `location`, because the page that resolves it is served by the same
 * vite server that proxies the socket through. An extension has no such
 * origin -- the popup runs at `-extension:` and the background at no origin at
 * all -- so this has to be absolute.
 *
 * `ws://` is accepted by favalib's `SyncManager` in production builds too; it
 * only rejects urls that are neither `ws://` nor `wss://`. Point this at a
 * `wss://` server for a real deployment.
 */
export const syncServerUrl = String(
  import.meta.env.WXT_SYNC_SERVER_URL ??
    import.meta.env.VITE_SYNCSERVERURL ??
    'ws://localhost:8080',
)

/**
 * Identifies this client to the other devices in the vault.
 *
 * Shows up in the sync device list, so it should stay distinct from
 * app-browser's `browser` and app-cli's `cli`.
 */
export const deviceType = 'extension' as DeviceType

/**
 * Extra words zxcvbn should treat as worthless in a master password.
 *
 * Mirrors app-browser's `['browser']`, plus the words this client puts in
 * front of the user.
 */
export const passwordExtraDict = ['extension', 'browser', 'fava'] as const
