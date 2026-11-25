import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

import { buildEngine } from '../scripts/build.mjs'

declare module 'vitest' {
  export interface ProvidedContext {
    productionBundle: string
  }
}

/**
 * Builds the bundle the way `make build` does, once for every test file.
 * @param project - The vitest project.
 * @returns Cleanup.
 */
export default async function setup(project: TestProject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'favaenginejsc-'))
  const productionBundle = path.join(dir, 'fava-engine.js')
  await buildEngine({ outfile: productionBundle })
  project.provide('productionBundle', productionBundle)
  return () => fs.rmSync(dir, { recursive: true, force: true })
}
