// Loaded after the bundle by tests/jsc.test.mts. Prints JSC_SMOKE_OK on
// success; anything else is a failure, with the reason printed.
;(async () => {
  const print = globalThis.__shellPrint
  const call = async (method, ...args) =>
    JSON.parse(await globalThis.favaEngine.call(method, JSON.stringify(args)))
  try {
    if (typeof WebAssembly !== 'undefined')
      throw new Error('WebAssembly is present')
    await call('configure', { deviceType: 'jsc-smoke' })
    await call('createVault', 'correct-horse-battery-staple-ios-9!')
    const id = await call('addEntry', {
      name: 'Smoke',
      issuer: 'jsc',
      type: 'TOTP',
      payload: {
        secret: 'JBSWY3DPEHPK3PXP',
        period: 30,
        algorithm: 'SHA-1',
        digits: 6,
      },
    })
    const token = await call('token', id, 1700000000000)
    if (token.otp !== '324550') throw new Error(`wrong code ${token.otp}`)
    await call(
      'importUri',
      'otpauth://totp/ACME:a%40b.c?secret=GEZDGNBVGY3TQOJQ&issuer=ACME',
    )
    const exported = await call('exportText', 'export-password')
    await call('importText', exported, 'export-password')
    const session = await call('exportUnlockedSession')
    await call('lock')
    await call('unlockWithSession', globalThis.__lastSave, session, false)
    await call('lock')
    await call(
      'unlockWithPassword',
      globalThis.__lastSave,
      'correct-horse-battery-staple-ios-9!',
      false,
    )
    const entries = await call('listEntries')
    if (entries.length !== 4)
      throw new Error(`expected 4 entries, got ${entries.length}`)
    print('JSC_SMOKE_OK')
  } catch (error) {
    print(`JSC_SMOKE_FAIL ${error && error.message}\n${error && error.stack}`)
  }
})()
