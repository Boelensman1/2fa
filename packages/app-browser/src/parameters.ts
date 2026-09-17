import type { DeviceType } from 'favalib'

/**
 * Resolves what the user typed into a url favalib will accept.
 *
 * A path is resolved against the origin serving the app, which is what lets the
 * dev/preview server proxy the connection through to the sync server on the same
 * port the app itself is served from. An absolute ws:// or wss:// url is used
 * as-is.
 *
 * Applied to the value on its way OUT of the sync server form rather than to
 * the prefill, so that someone who types `/sync` themselves gets the same
 * treatment as someone who accepts the default -- favalib needs an absolute
 * url, and a relative one reaches it as a connection that simply never opens.
 * @param value - A path, or an absolute ws:// or wss:// url.
 * @returns An absolute url.
 */
export const toSyncServerUrl = (value: string) =>
  value.startsWith('/')
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${value}`
    : value

/**
 * What the sync-server form starts out filled in with -- a PREFILL, not a
 * setting.
 *
 * The url used to be baked into every vault at creation. It no longer is: a
 * sync server will not accept a socket without its shared secret, the user is
 * the only one who can supply that, and a url without one configures nothing.
 * So both fields are asked for together and stored in the vault, and these two
 * values only save some typing in the container.
 */
export const syncServerUrlPrefill =
  import.meta.env.VITE_DEVSYNCSERVERURL ?? '/sync'

/**
 * The dev prefill for the server secret. Empty unless someone set the var.
 *
 * DEVELOPMENT ONLY, and the `DEV` in the name is the whole warning: anything
 * reachable from `import.meta.env` is compiled into the bundle, so setting this
 * in a publicly served build publishes the secret to everyone who loads the
 * app. It is set by milly2-container/milly.nix for the container dev server and
 * nowhere else.
 */
export const syncServerSecretPrefill =
  import.meta.env.VITE_DEVSERVERSECRET ?? ''

export const deviceType = 'web' as DeviceType

export const version = import.meta.env.VITE_COMMIT_HASH ?? 'unknown'
export const passwordExtraDict = ['browser', 'web'] as const
