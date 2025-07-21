import type { Jsonifiable } from 'type-fest'
import type { EntryMeta, EntryMetaWithToken } from 'favalib'
import { Formatter } from '../BaseListOutputCommand.mjs'
import type { ErrorInCommand } from '../BaseCommand.mjs'

interface AlfredItem {
  title: string
  subtitle: string
  arg?: string
}

const alfredFormatter: Formatter = (
  entries: (EntryMeta | EntryMetaWithToken)[],
  errors: ErrorInCommand[],
) => {
  const items: AlfredItem[] = entries.map((entry) => ({
    title: entry.issuer,
    subtitle: entry.name,
    arg: (entry as EntryMetaWithToken).token?.otp,
  }))
  if (errors.length > 0) {
    items.unshift({
      title: `Favacli encountered ${errors.length} errors while processing your command`,
      subtitle: errors.map((e, i) => `[${i}]: ${e.message}`).join(' '),
    })
  }
  return { items: items as unknown as Jsonifiable }
}

export default { name: 'alfred' as const, formatter: alfredFormatter }
