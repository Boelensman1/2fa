/**
 * Installs every polyfill. Imported first by main.mts, before anything from
 * favalib: some of its modules read globals at load time (the browser crypto
 * provider captures `globalThis.crypto` as a module constant), and ESM
 * evaluates imports in order.
 *
 * Each installer only fills what is missing, so the same bundle also runs in a
 * WKWebView or a test runner that already has the real thing.
 */
import { installGlobals } from './globals.mjs'
import { installEncoding } from './encoding.mjs'
import { installEvents } from './events.mjs'
import { installCrypto } from './crypto.mjs'
import { installWebSocket } from './websocket.mjs'
import './url.mjs'

installGlobals()
installEncoding()
installEvents()
installCrypto()
installWebSocket()
