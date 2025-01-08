import fs from 'node:fs/promises'
import path from 'node:path'

import envPaths from 'env-paths'
import type { LockedRepresentationString } from 'favalib'

export interface Settings {
  vaultLocation: string
}

const getDefaultSettings = (): Settings => ({
  vaultLocation: path.join(envPaths('favacli').data, 'vault.json'),
})

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

const ensureDirectoriesExists = async (...paths: string[]) => {
  for (const p of paths) {
    const directory = path.dirname(p)
    await fs.mkdir(directory, { recursive: true })
  }
}

const init = async () => {
  const settingsLocation = path.join(
    envPaths('favacli').config,
    'settings.json',
  )

  let settings = await readJSONFile<Settings>(settingsLocation)
  if (!settings) {
    settings = getDefaultSettings()
    await ensureDirectoriesExists(settingsLocation, settings.vaultLocation)
    await fs.writeFile(settingsLocation, JSON.stringify(settings, null, 2))
  }

  const lockedRepresentationString = (await readFile(
    settings.vaultLocation,
  )) as LockedRepresentationString

  return { settings, lockedRepresentationString }
}

export default init
