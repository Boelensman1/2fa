/**
 * The bundle's entry point.
 *
 * The polyfills must come first: favalib's modules read globals while they
 * load (see polyfills/index.mts).
 */
import './polyfills/index.mjs'
import { FavaEngine } from './engine.mjs'

;(globalThis as { favaEngine?: FavaEngine }).favaEngine = new FavaEngine()
