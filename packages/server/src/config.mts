import path from 'node:path'
import { WtfConfigContainer } from 'wtfconfig'
import { ConfigObjectSchema } from './types/ConfigObject.mjs'

const configContainer = new WtfConfigContainer(
  process.cwd(),
  ConfigObjectSchema,
  path.resolve('config'),
  { dontWarnOnFileMissing: true },
)

export const config = configContainer.getConfig()
