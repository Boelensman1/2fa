import type { DeviceType } from 'favalib'

import pkg from '../package.json'

export const defaultLanguage = 'en'
export const version = pkg.version

export const buildFor = String(import.meta.env.BROWSER ?? 'chrome')

/**
 * What the sync-server form starts out filled in with -- a PREFILL, not a
 * setting.
 *
 * The url used to be baked into every vault at creation. It no longer is: the
 * server will not accept a socket without its shared secret, only the user can
 * supply that, and a url without one configures nothing. So both are asked for
 * together and stored in the vault.
 *
 * Absolute, where `../app-browser` can default to the path `/sync` and
 * resolve it against `location`. The page that resolves it there is served by
 * the same vite server that proxies the socket through; an extension has no
 * such origin -- the popup runs at `-extension:` and the background at no
 * origin at all -- so there is nothing for a path to be relative to.
 *
 * `ws://` is accepted by favalib's `SyncManager` in production builds too; it
 * only rejects urls that are neither `ws://` nor `wss://`. Point this at a
 * `wss://` server for a real deployment.
 */
export const syncServerUrlPrefill = String(
  import.meta.env.WXT_SYNC_SERVER_URL ??
    import.meta.env.VITE_SYNCSERVERURL ??
    'ws://localhost:8080',
)

/**
 * The dev prefill for the server secret. Empty unless someone set the var.
 *
 * DEVELOPMENT ONLY, and the `DEV` in the name is the whole warning: anything
 * reachable from `import.meta.env` is compiled into the bundle, so setting this
 * for a build that gets distributed publishes the secret to everyone who
 * installs it. An extension bundle is as readable as a served one -- unpacking
 * a `.crx` is a `unzip`.
 */
export const syncServerSecretPrefill = String(
  import.meta.env.WXT_DEV_SERVER_SECRET ??
    import.meta.env.VITE_DEVSERVERSECRET ??
    '',
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
