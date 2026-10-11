/**
 * URL and URLSearchParams, from core-js's WHATWG implementation.
 *
 * favalib's platform providers already make URL parsing injectable
 * (UrlParserLib), but its core uses the globals directly too: URL matchers,
 * the sync server url check and otpauth query parsing. So a global is needed
 * either way, and with one installed the browser provider's parser works
 * unchanged.
 *
 * Only the two modules, not core-js as a whole: everything else core-js
 * polyfills, JavaScriptCore already has.
 */
import 'core-js/actual/url/index.js'
import 'core-js/actual/url-search-params/index.js'
