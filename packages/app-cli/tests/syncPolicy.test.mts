import { describe, expect, it } from 'vitest'

import {
  shouldConnectToSyncServer,
  SYNC_INTERVAL_MS,
} from '../src/utils/syncPolicy.mjs'

const now = 1_750_000_000_000

describe('shouldConnectToSyncServer', () => {
  it('syncs when no previous successful sync was recorded', () => {
    expect(shouldConnectToSyncServer({ now })).toBe(true)
  })

  it('skips a sync performed less than five minutes ago', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        lastSyncedAt: now - SYNC_INTERVAL_MS + 1,
      }),
    ).toBe(false)
  })

  it('syncs at the five-minute boundary', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        lastSyncedAt: now - SYNC_INTERVAL_MS,
      }),
    ).toBe(true)
  })

  it('uses a configured sync interval', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        lastSyncedAt: now - 60_000,
        syncIntervalMs: 60_001,
      }),
    ).toBe(false)
    expect(
      shouldConnectToSyncServer({
        now,
        lastSyncedAt: now - 60_000,
        syncIntervalMs: 60_000,
      }),
    ).toBe(true)
  })

  it('allows a zero interval to sync every time', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        lastSyncedAt: now,
        syncIntervalMs: 0,
      }),
    ).toBe(true)
  })

  it('treats invalid and future timestamps as stale', () => {
    expect(shouldConnectToSyncServer({ now, lastSyncedAt: NaN })).toBe(true)
    expect(shouldConnectToSyncServer({ now, lastSyncedAt: now + 1 })).toBe(true)
  })

  it('supports force-sync and no-sync overrides', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        forceSync: true,
        lastSyncedAt: now,
      }),
    ).toBe(true)
    expect(
      shouldConnectToSyncServer({
        now,
        noSync: true,
        lastSyncedAt: 0,
      }),
    ).toBe(false)
  })

  it('rejects contradictory overrides', () => {
    expect(() =>
      shouldConnectToSyncServer({ forceSync: true, noSync: true }),
    ).toThrow('--force-sync and --no-sync cannot be used together')
  })

  it('always connects for sync commands and rejects no-sync', () => {
    expect(
      shouldConnectToSyncServer({
        now,
        requiresSyncConnection: true,
        lastSyncedAt: now,
      }),
    ).toBe(true)
    expect(() =>
      shouldConnectToSyncServer({
        requiresSyncConnection: true,
        noSync: true,
      }),
    ).toThrow('--no-sync cannot be used with sync commands')
  })
})
