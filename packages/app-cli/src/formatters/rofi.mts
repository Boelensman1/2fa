import type { EntryMeta, EntryMetaWithToken } from 'favalib'
import { Formatter } from '../BaseListOutputCommand.mjs'
import type { ErrorInCommand } from '../BaseCommand.mjs'

const NUL = '\0' // separates display text from the row's options
const US = '\x1f' // separates option key/value pairs

const rofiFormatter: Formatter = (
  entries: (EntryMeta | EntryMetaWithToken)[],
  errors: ErrorInCommand[],
) => {
  const lines: string[] = [`${NUL}prompt${US}2FA`]

  if (errors.length > 0) {
    const msg = errors.map((e, i) => `[${i}] ${e.message}`).join(' ')
    lines.push(`${NUL}message${US}${msg}`)
  }

  for (const entry of entries) {
    const display = `${entry.issuer}: ${entry.name}`
    lines.push(
      `${display}${NUL}info${US}${entry.id}${US}meta${US}${entry.issuer} ${entry.name}`,
    )
  }

  return lines.join('\n')
}

// raw: rofi script mode consumes line-based text with embedded control bytes,
// so this output must be written to stdout verbatim, not JSON-stringified.
export default { name: 'rofi' as const, formatter: rofiFormatter, raw: true }
