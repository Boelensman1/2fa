/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

const insertIdColumn = (table: Knex.CreateTableBuilder) => {
  // use posgres's special IDENTITY type. This way if we, erroneously try to
  // insert while supplying an id, an error is thrown
  table.specificType(
    'id',
    'integer NOT NULL GENERATED ALWAYS AS IDENTITY ( INCREMENT 1 START 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 ) UNIQUE',
  )
}

export default insertIdColumn
