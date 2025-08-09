import _ from 'lodash'
import type { Manifest } from 'webextension-polyfill'

import { getBaseManifest } from './base'

export function getManifest(): Manifest.WebExtensionManifest {
  const baseManifest = getBaseManifest()
  return {
    ..._.omit(baseManifest, ['action', 'host_permissions']),
    manifest_version: 2,
    browser_action: {
      ..._.omit(baseManifest.action, 'type'),
      browser_style: false,
      default_area: 'navbar',
    },
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    content_security_policy:
      // @ts-expect-error Incompatability between manifest_version 2 & 3
      baseManifest.content_security_policy.extension_pages,
    permissions: [...baseManifest.permissions!, '<all_urls>'],
    content_scripts: [
      { ...baseManifest.content_scripts![0], run_at: 'document_start' },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'favaext@appeal.nl',
      },
    },
    background: {
      scripts: ['src/entries/background-script/index.ts'],
    },
  } as Manifest.WebExtensionManifest
}
