// @ts-expect-error this works
import RefreshRuntime from '/@react-refresh'

if (import.meta.hot) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  RefreshRuntime.injectIntoGlobalHook(window)
  // @ts-expect-error this works
  window.$RefreshReg$ = () => {
    /* no-op */
  }
  // @ts-expect-error this works
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  window.$RefreshSig$ = () => (type) => type
  // @ts-expect-error this works
  window.__vite_plugin_react_preamble_installed__ = true
}
