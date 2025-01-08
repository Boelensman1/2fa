import { Option } from 'clipanion'
import type { EntryMeta, EntryMetaWithToken } from 'favalib'

import BaseCommand from './BaseCommand.mjs'

import generateEntriesTable from './utils/generateEntriesTable.mjs'
import formatters from './formatters/index.mjs'
import { JsonArray } from 'type-fest'

const formattersMap = new Map(formatters.map((f) => [f.name, f.formatter]))

export type Formatter = (
  entries: (EntryMeta | EntryMetaWithToken)[],
) => JsonArray

abstract class BaseListOutputCommand extends BaseCommand {
  abstract getList(): EntryMeta[] | EntryMetaWithToken[]

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  format = Option.String('--format', {
    description: 'formatter',
  }) as (typeof formatters)[0]['name'] | undefined

  // eslint-disable-next-line @typescript-eslint/require-await
  async exec() {
    let formatter: Formatter = (json: EntryMeta[]) =>
      json as unknown as JsonArray

    if (this.format) {
      const selectedFormatter = formattersMap.get(this.format)
      if (!selectedFormatter) {
        throw new Error(`Formatter ${this.format} not found`)
      }
      formatter = selectedFormatter
    }

    const list = this.getList()
    if (list.length === 0) {
      this.context.stdout.write('No entries\n')
      return formatter([])
    }

    this.output(generateEntriesTable(list))
    return formatter(list) as unknown as JsonArray
  }
}

export default BaseListOutputCommand
