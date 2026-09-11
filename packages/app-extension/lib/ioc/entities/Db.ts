import { injectable } from 'inversify'
import { storage } from 'wxt/utils/storage'

const META_KEY_PREFIX = 'local:meta:' as const

@injectable()
class PersistentDatabase {
  private initialized = false

  async init(reset = false) {
    if (reset) {
      await this.reset()
    }
    this.initialized = true
  }

  get isOpen() {
    return this.initialized
  }

  async upsertMetaKV(key: string, value: string) {
    await storage.setItem(`${META_KEY_PREFIX}${key}`, value)
  }

  async deleteMetaKV(key: string) {
    await storage.removeItem(`${META_KEY_PREFIX}${key}`)
  }

  async getMetaValue(key: string): Promise<string | undefined> {
    const value = await storage.getItem<string>(`${META_KEY_PREFIX}${key}`)
    return value ?? undefined
  }

  close() {
    // No-op: WXT storage doesn't require explicit closing
    this.initialized = false
  }

  async reset() {
    await storage.clear('local')
  }
}

export default PersistentDatabase
