import path from 'node:path'
import { WtfConfigContainer } from 'wtfconfig'
import { ConfigObject } from './types/ConfigObject.mjs'

const configContainer = new WtfConfigContainer<ConfigObject>(
  process.cwd(),
  path.resolve('generated/configSchema.json'),
  path.resolve('config'),
  { dontWarnOnFileMissing: true },
)

export const config = configContainer.getConfig()
