import type { EntryMeta, EntryMetaWithToken } from 'favalib'

import BaseCommand from './BaseCommand.mjs'
import type { ErrorInCommand } from './BaseCommand.mjs'

import generateEntriesTable from './utils/generateEntriesTable.mjs'
import formatters from './formatters/index.mjs'
import { Jsonifiable, JsonArray } from 'type-fest'

const formattersMap = new Map<string, (typeof formatters)[number]>(
  formatters.map((f) => [f.name, f]),
)

export type Formatter = (
  entries: (EntryMeta | EntryMetaWithToken)[],
  errors: ErrorInCommand[],
) => Jsonifiable

abstract class BaseListOutputCommand extends BaseCommand {
  abstract getList(): Promise<(EntryMeta | EntryMetaWithToken)[]>

  protected validFormats(): string[] {
    return ['json', ...formatters.map((f) => f.name)]
  }

  async exec() {
    let formatter: Formatter = (json: EntryMeta[]) =>
      json as unknown as JsonArray

    // 'json' (and no --format) uses the default identity formatter and is
    // wrapped in { result, errors } by BaseCommand; named formatters produce
    // pre-formatted output instead
    if (this.format && this.format !== 'json') {
      const selectedFormatter = formattersMap.get(this.format)
      if (!selectedFormatter) {
        throw new Error(`Formatter ${this.format} not found`)
      }
      formatter = selectedFormatter.formatter
      this.preFormattedOutput = true
      this.rawOutput = 'raw' in selectedFormatter && selectedFormatter.raw
    }

    const list = await this.getList()
    if (list.length === 0) {
      // output() suppresses this when --format is set, so it can't corrupt the
      // machine-readable formatter output
      this.output('No entries\n')
      return formatter([], this.errors)
    }

    this.output(generateEntriesTable(list))
    return formatter(list, this.errors) as unknown as JsonArray
  }
}

export default BaseListOutputCommand
