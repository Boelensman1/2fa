import fs from 'node:fs/promises'
import type { LockedRepresentationString } from 'favalib'
import type { EmptyObject } from 'type-fest'

export type Settings = EmptyObject

const defaultSettings: Settings = {}

const readFile = async (path: string): Promise<string | null> => {
  try {
    return (await fs.readFile(path)).toString()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

const readJSONFile = async <T,>(path: string): Promise<T | null> => {
  const contents = await readFile(path)
  if (!contents) {
    return null
  }
  return JSON.parse(contents) as T
}

const init = async () => {
  let settings = await readJSONFile<Settings>('settings.json')
  if (!settings) {
    settings = defaultSettings
    await fs.writeFile('settings.json', JSON.stringify(settings, null, 2))
  }

  const lockedRepresentationString = (await readFile(
    'vault.json',
  )) as LockedRepresentationString

  return { settings, lockedRepresentationString }
}

export default init
