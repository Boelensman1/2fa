import pkg from '../package.json'

export const defaultLanguage = 'en'
export const version = pkg.version

export const buildFor = String(import.meta.env.VITE_BUILDFOR ?? 'chrome')
