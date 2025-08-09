import { injectable } from 'inversify'
import {
  openDB,
  deleteDB,
  DBSchema,
  type IDBPDatabase,
  StoreNames,
  StoreValue,
  StoreKey,
} from 'idb'
import { Logger } from '../../internals'

const log = new Logger('classes/db')

type IndexType<T, K extends keyof T | (keyof T)[]> = K extends keyof T
  ? T[K]
  : K extends (keyof T)[]
    ? { [P in keyof K]: K[P] extends keyof T ? T[K[P]] : never }
    : never

export interface ToDBSchema<
  T,
  U,
  I extends Record<string, keyof T | (keyof T)[]> = Record<string, never>,
> {
  key: U
  value: T
  indexes: { [K in keyof I]: IndexType<T, I[K]> }
}
interface MetaEntry {
  key: string
  value: string
}

interface DGDBSchema extends DBSchema {
  metaKV: ToDBSchema<MetaEntry, string>
}

const upgrade = (
  db: IDBPDatabase<DGDBSchema> /*, oldVersion, newVersion, transaction, event*/,
) => {
  db.createObjectStore('metaKV', {
    keyPath: 'key',
  })
}

@injectable()
class PersistentDatabase {
  private db!: IDBPDatabase<DGDBSchema>

  async init(reset = false) {
    // temporary, reset the db on init
    if (reset) {
      await deleteDB('fava-extension')
    }

    // enable persistence storage if available (only on firefox)
    // this shouldn't be needed on either chrome or firefox, but it can't hurt
    // see: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/EfAXciu90yY?pli=1
    // and https://issues.chromium.org/issues/41294627
    if (
      typeof navigator !== 'undefined' && // no navigator in tests
      navigator.storage?.persist
    ) {
      await navigator.storage.persist()
    }

    const db = await openDB<DGDBSchema>('fava-extension', 1, {
      upgrade,
      blocked(/*currentVersion, blockedVersion, event*/) {
        log.error(new Error('IndexedDb open blocked'))
      },
      blocking(/*currentVersion, blockedVersion, event*/) {
        log.error(new Error('IndexedDb open blocking'))
      },
      terminated() {
        log.error(new Error('IndexedDb open terminated'))
      },
    })

    this.db = db

    db.onerror = () => {
      log.error(new Error('IndexedDb Error'))
    }
    db.onabort = () => {
      log.error(new Error('IndexedDb aborted'))
    }
    db.onclose = () => {
      log.error(new Error('IndexedDb closed'))
    }
  }

  get isOpen() {
    // TODO: check if this works
    return Boolean(this.db?.version)
  }

  private async del<U extends StoreNames<DGDBSchema>>(
    store: U,
    key: StoreKey<DGDBSchema, U>,
  ) {
    return this.db.delete(store, key)
  }
  private async put<U extends StoreNames<DGDBSchema>>(
    store: U,
    value: StoreValue<DGDBSchema, U>,
  ) {
    return this.db.put(store, value)
  }
  /*
  private async update<U extends StoreNames<DGDBSchema>>(
    store: U,
    value: StoreValue<DGDBSchema, U>,
    key?: StoreKey<DGDBSchema, U>,
  ) {
    return this.db.put(store, value, key)
  }
  private async add<U extends StoreNames<DGDBSchema>>(
    store: U,
    value: StoreValue<DGDBSchema, U>,
  ) {
    return this.db.add(store, value)
  }
  */
  private async get<U extends StoreNames<DGDBSchema>>(
    store: U,
    key: StoreKey<DGDBSchema, U>,
  ) {
    return this.db.get(store, key)
  }

  /*
  private async getFromIndex<
    U extends StoreNames<DGDBSchema>,
    V extends IndexNames<DGDBSchema, U>,
  >(store: U, indexKey: V, indexValue: IndexKey<DGDBSchema, U, V>) {
    return this.db.getFromIndex(store, indexKey, indexValue)
  }
  private async getKeyFromIndex<
    U extends StoreNames<DGDBSchema>,
    V extends IndexNames<DGDBSchema, U>,
  >(store: U, indexKey: V, indexValue: IndexKey<DGDBSchema, U, V>) {
    return this.db.getKeyFromIndex(store, indexKey, indexValue)
  }
  */

  async upsertMetaKV(key: string, value: string) {
    await this.put('metaKV', { key, value })
  }
  async deleteMetaKV(key: string) {
    await this.del('metaKV', key)
  }

  async getMetaValue(key: string): Promise<string | undefined> {
    const metaEntry = await this.get('metaKV', key)
    return metaEntry ? metaEntry.value : undefined
  }

  close() {
    this.db.close()
  }

  async reset() {
    type AllStoreNames = StoreNames<DGDBSchema>

    // Done like this so we get a typescript error if a key is missing
    const stores: Record<AllStoreNames, boolean> = {
      metaKV: true,
    }

    await Promise.all(
      Object.keys(stores).map(async (key) =>
        this.db.clear(key as AllStoreNames),
      ),
    )
  }
}

export default PersistentDatabase
