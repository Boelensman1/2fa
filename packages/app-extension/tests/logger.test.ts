import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: vi.fn() } },
}))

const importLogger = async () => {
  vi.resetModules()
  return import('../lib/classes/Logger')
}

afterEach(() => {
  vi.resetModules()
})

describe('setVerboseLogging', () => {
  it('lowers the level of loggers that already exist', async () => {
    const { default: Logger, setVerboseLogging } = await importLogger()
    const log = new Logger('test')
    const before = log.outputLevel

    setVerboseLogging(true)

    expect(log.outputLevel).toBeLessThan(before)
  })

  it('applies to loggers constructed afterwards', async () => {
    // A module imported lazily must not silently start at the build default
    // after the user has asked for verbose logging.
    const { default: Logger, setVerboseLogging } = await importLogger()
    setVerboseLogging(true)

    expect(new Logger('later').outputLevel).toBe(
      new Logger('earlier').outputLevel,
    )
  })

  it('restores the build default when turned off', async () => {
    const { default: Logger, setVerboseLogging } = await importLogger()
    const log = new Logger('test')
    const before = log.outputLevel

    setVerboseLogging(true)
    setVerboseLogging(false)

    expect(log.outputLevel).toBe(before)
  })
})
