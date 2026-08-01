export const SYNC_INTERVAL_MS = 5 * 60 * 1000

interface SyncPolicyOptions {
  forceSync?: boolean
  noSync?: boolean
  requiresSyncConnection?: boolean
  lastSyncedAt?: number
  now?: number
  syncIntervalMs?: number
}

export const shouldConnectToSyncServer = ({
  forceSync = false,
  noSync = false,
  requiresSyncConnection = false,
  lastSyncedAt,
  now = Date.now(),
  syncIntervalMs = SYNC_INTERVAL_MS,
}: SyncPolicyOptions): boolean => {
  if (forceSync && noSync) {
    throw new Error('--force-sync and --no-sync cannot be used together')
  }

  if (requiresSyncConnection) {
    if (noSync) {
      throw new Error('--no-sync cannot be used with sync commands')
    }
    return true
  }

  if (noSync) return false
  if (forceSync) return true

  if (
    typeof lastSyncedAt !== 'number' ||
    !Number.isFinite(lastSyncedAt) ||
    lastSyncedAt > now
  ) {
    return true
  }

  return now - lastSyncedAt >= syncIntervalMs
}
