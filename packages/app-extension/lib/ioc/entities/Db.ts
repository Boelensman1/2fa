import { injectable } from 'inversify'
import { storage } from 'wxt/utils/storage'

const META_KEY_PREFIX = 'local:meta:' as const

/**
 * `session:` is browser.storage.session -- memory-backed, wiped when the
 * browser closes, and readable only from trusted contexts (not content
 * scripts). It is what lets an unlocked vault survive the service worker
 * being evicted, which mv3 does after ~30s idle.
 */
const SESSION_KEY_PREFIX = 'session:' as const

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

  async setSessionValue(key: string, value: string) {
    await storage.setItem(`${SESSION_KEY_PREFIX}${key}`, value)
  }

  async getSessionValue(key: string): Promise<string | undefined> {
    const value = await storage.getItem<string>(`${SESSION_KEY_PREFIX}${key}`)
    return value ?? undefined
  }

  async deleteSessionValue(key: string) {
    await storage.removeItem(`${SESSION_KEY_PREFIX}${key}`)
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
