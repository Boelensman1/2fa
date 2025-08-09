import type { Manifest } from 'webextension-polyfill'

import { getBaseManifest } from './base'

export function getManifest(): Manifest.WebExtensionManifest {
  const baseManifest = getBaseManifest()
  return {
    ...baseManifest,
    background: {
      service_worker: 'src/entries/background-script/index.ts',
      // type: 'module',
    },
  }
}
