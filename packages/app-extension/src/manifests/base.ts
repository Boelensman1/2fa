import pkg from '../../package.json'

import type { Manifest } from 'webextension-polyfill'

const manifest = {
  action: {
    default_icon: {
      16: 'icons/16.png',
      19: 'icons/19.png',
      32: 'icons/32.png',
      38: 'icons/38.png',
    },
    default_popup: 'src/ui/popup/index.html',
    default_title: 'Browser AI',
    type: 'module',
  },
  content_scripts: [
    {
      js: ['src/entries/content-script/index.ts'],
      matches: ['<all_urls>'],
      all_frames: true,
    },
  ],
  host_permissions: ['<all_urls>'],
  permissions: [
    'webRequest',
    'storage',
    'unlimitedStorage',
    'tabs',
  ] as Manifest.Permission[],
  icons: {
    16: 'icons/16.png',
    19: 'icons/19.png',
    32: 'icons/32.png',
    38: 'icons/38.png',
    48: 'icons/48.png',
    64: 'icons/64.png',
    96: 'icons/96.png',
    128: 'icons/128.png',
    256: 'icons/256.png',
    512: 'icons/512.png',
  },
  /*
  options_ui: {
    page: 'src/ui/pages/index.html',
    open_in_tab: true,
  },
  */
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
  // default_locale: 'en',
}

export function getBaseManifest(): Manifest.WebExtensionManifest {
  return {
    author: 'boelensman1',
    name: 'fava-extension',
    description: 'fava-extension',
    version: pkg.version,
    manifest_version: 3,
    ...manifest,
  }
}
