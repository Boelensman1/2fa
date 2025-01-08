import type { EntryMeta, EntryMetaWithToken } from 'favalib'
import { Formatter } from '../BaseListOutputCommand.mjs'

const alfredFormatter: Formatter = (
  entries: (EntryMeta | EntryMetaWithToken)[],
) => ({
  items: entries.map((entry) => ({
    title: entry.issuer,
    subtitle: entry.name,
    arg: (entry as EntryMetaWithToken).token?.otp,
  })),
})

export default { name: 'alfred' as const, formatter: alfredFormatter }
