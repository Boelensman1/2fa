import Table from 'tty-table'
import type { EntryMeta, EntryMetaWithToken } from 'favalib'

const generateEntriesTable = (
  entries: EntryMeta[] | EntryMetaWithToken[],
): string => {
  const headers = [
    { value: 'Id', align: 'left', width: 30 },
    { value: 'Name', align: 'left', width: 30 },
    { value: 'Issuer', align: 'left', width: 20 },
    { value: 'Added at', align: 'left', width: 36 },
    { value: 'Updated at', align: 'left', width: 36 },
  ]

  const withTokens = (entries[0] as EntryMetaWithToken).token

  if (withTokens) {
    headers.push({ value: 'Token', align: 'left', width: 10 })
  }

  const rows = entries.map((entry) => {
    const row = [
      entry.id,
      entry.name || '-',
      entry.issuer || '-',
      new Date(entry.addedAt).toLocaleString(),
      entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : '-',
    ]

    if (withTokens) {
      row.push((entry as EntryMetaWithToken).token.otp)
    }

    return row
  })

  const tableOptions = {
    borderStyle: 'solid',
    paddingLeft: 1,
    paddingRight: 1,
    headerAlign: 'left',
  }

  return Table(headers, rows, [], tableOptions).render() + '\n'
}

export default generateEntriesTable
