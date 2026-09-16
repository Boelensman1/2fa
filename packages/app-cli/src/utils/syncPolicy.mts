export const SYNC_INTERVAL_MS = 5 * 60 * 1000

interface SyncPolicyOptions {
  forceSync?: boolean
  noSync?: boolean
  requiresSyncConnection?: boolean
  mutatesVault?: boolean
  lastSyncedAt?: number
  now?: number
  syncIntervalMs?: number
}

export const shouldConnectToSyncServer = ({
  forceSync = false,
  noSync = false,
  requiresSyncConnection = false,
  mutatesVault = false,
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

  // The interval throttles reads, which only go stale. A write has to reach
  // the other devices, and this process is about to exit, so it is worth a
  // connection however recently we last synced. --no-sync still opts out: the
  // command is queued and goes out on the next connection.
  if (mutatesVault) return true

  if (
    typeof lastSyncedAt !== 'number' ||
    !Number.isFinite(lastSyncedAt) ||
    lastSyncedAt > now
  ) {
    return true
  }

  return now - lastSyncedAt >= syncIntervalMs
}
