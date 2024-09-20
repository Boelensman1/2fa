import { describe, it, expect, beforeEach } from 'vitest'
import { JPake, deriveSFromPassword } from '../src/main.mjs'
import { n } from '../src/constants.mjs'
import { ProjPointType } from '@noble/curves/abstract/weierstrass'

describe('JPake', () => {
  let alice: JPake
  let bob: JPake
  const password = 'secretPassword123'
  const s = deriveSFromPassword(password)

  beforeEach(() => {
    // Create new JPake instances for each test
    alice = new JPake('Alice')
    bob = new JPake('Bob')
  })

  it('should successfully complete a key exchange', () => {
    // Simulate the J-PAKE protocol exchange
    const aliceRound1 = alice.round1()
    const bobRound1 = bob.round1()

    const aliceRound2 = alice.round2(bobRound1, s, bob.userId)
    const bobRound2 = bob.round2(aliceRound1, s, alice.userId)

    alice.setRound2ResultFromBob(bobRound2)
    bob.setRound2ResultFromBob(aliceRound2)

    // Derive and compare the shared keys
    const aliceSharedKey = alice.deriveSharedKey()
    const bobSharedKey = bob.deriveSharedKey()

    expect(aliceSharedKey).toEqual(bobSharedKey)
  })

  it('should fail key exchange with incorrect password', () => {
    // Simulate the exchange with a wrong password for Bob
    const aliceRound1 = alice.round1()
    const bobRound1 = bob.round1()

    const aliceRound2 = alice.round2(bobRound1, s, bob.userId)
    const bobRound2 = bob.round2(
      aliceRound1,
      deriveSFromPassword('wrongPassword'),
      alice.userId,
    )

    alice.setRound2ResultFromBob(bobRound2)
    bob.setRound2ResultFromBob(aliceRound2)

    const aliceSharedKey = alice.deriveSharedKey()
    const bobSharedKey = bob.deriveSharedKey()

    // Expect the derived keys to be different
    expect(aliceSharedKey).not.toEqual(bobSharedKey)
  })

  it('should throw error when trying to derive key before completing exchange', () => {
    // Attempt to derive the key without completing the exchange
    expect(() => alice.deriveSharedKey()).toThrow()
  })

  it("should throw error when trying to share a key with equal userId's", () => {
    // Attempt to perform the exchange between two instances with the same userId
    const alsoAlice = new JPake('Alice')
    alice.round1()
    const alsoAliceRound1 = alsoAlice.round1()

    expect(() =>
      alice.round2(alsoAliceRound1, s, alsoAlice.userId),
    ).toThrowError('Proof verification failed, userIds are equal.')
  })

  it('should generate different shared keys for different sessions', () => {
    // Create two separate J-PAKE sessions
    const session1 = { alice: new JPake('Alice'), bob: new JPake('Bob') }
    const session2 = { alice: new JPake('Alice'), bob: new JPake('Bob') }

    // Complete exchange for session 1
    const session1AliceRound1 = session1.alice.round1()
    const session1BobRound1 = session1.bob.round1()
    const session1AliceRound2 = session1.alice.round2(
      session1BobRound1,
      s,
      session1.bob.userId,
    )
    const session1BobRound2 = session1.bob.round2(
      session1AliceRound1,
      s,
      session1.alice.userId,
    )

    // Complete exchange for session 2
    const session2AliceRound1 = session2.alice.round1()
    const session2BobRound1 = session2.bob.round1()
    const session2AliceRound2 = session2.alice.round2(
      session2BobRound1,
      s,
      session2.bob.userId,
    )
    const session2BobRound2 = session2.bob.round2(
      session2AliceRound1,
      s,
      session2.alice.userId,
    )

    session1.alice.setRound2ResultFromBob(session1BobRound2)
    session1.bob.setRound2ResultFromBob(session1AliceRound2)

    session2.alice.setRound2ResultFromBob(session2BobRound2)
    session2.bob.setRound2ResultFromBob(session2AliceRound2)

    // Derive keys for both sessions
    const key1 = session1.alice.deriveSharedKey()
    const key2 = session2.alice.deriveSharedKey()

    // Expect the keys from different sessions to be different
    expect(key1).not.toEqual(key2)
  })

  it('should detect MITM attack in round 1', () => {
    const eve = new JPake('Eve')
    alice.round1()
    const eveRound1 = eve.round1()

    // Eve tries to intercept and replace Bob's round 1 data
    expect(() => alice.round2(eveRound1, s, bob.userId)).toThrow(
      'ZKP verification failed',
    )
  })

  it('should detect MITM attack in round 2', () => {
    const eve = new JPake('Eve')
    const aliceRound1 = alice.round1()
    const bobRound1 = bob.round1()
    eve.round1()

    alice.round2(bobRound1, s, bob.userId)
    const eveRound2 = eve.round2(
      aliceRound1,
      deriveSFromPassword('evePassword'),
      alice.userId,
    )

    // Eve tries to intercept and replace Bob's round 2 data
    alice.setRound2ResultFromBob(eveRound2)

    // Attempt to derive the key after the MITM attack:
    expect(() => alice.deriveSharedKey()).toThrow('ZKP verification failed')
  })

  it('should throw error when trying to create JPake instance with empty userId', () => {
    expect(() => new JPake('')).toThrow('UserId cannot be empty')
  })

  it('should throw error when trying to perform round2 with empty userId', () => {
    alice.round1()
    const bobRound1 = bob.round1()

    expect(() => alice.round2(bobRound1, s, '')).toThrow(
      'Missing required arguments for round 2',
    )
  })

  it('should successfully complete a key exchange with otherInfo', () => {
    const timestamp = Date.now().toString()
    const otherInfo = [timestamp]
    const aliceWOtherInfo = new JPake('AliceWithOtherInfo', otherInfo)
    const bobWOtherInfo = new JPake('BobWithOtherInfo', otherInfo)

    // Simulate the J-PAKE protocol exchange
    const aliceRound1 = aliceWOtherInfo.round1()
    const bobRound1 = bobWOtherInfo.round1()

    const aliceRound2 = aliceWOtherInfo.round2(
      bobRound1,
      s,
      bobWOtherInfo.userId,
    )
    const bobRound2 = bobWOtherInfo.round2(
      aliceRound1,
      s,
      aliceWOtherInfo.userId,
    )

    aliceWOtherInfo.setRound2ResultFromBob(bobRound2)
    bobWOtherInfo.setRound2ResultFromBob(aliceRound2)

    // Derive and compare the shared keys
    const aliceSharedKey = aliceWOtherInfo.deriveSharedKey()
    const bobSharedKey = bobWOtherInfo.deriveSharedKey()

    expect(aliceSharedKey).toEqual(bobSharedKey)
  })

  it('should fail key exchange when otherInfo does not match', () => {
    const aliceTimestamp = Date.now().toString()
    const bobTimestamp = (Date.now() + 1).toString() // Different timestamp
    const aliceWOtherInfo = new JPake('AliceWithOtherInfo', [aliceTimestamp])
    const bobWOtherInfo = new JPake('BobWithOtherInfo', [bobTimestamp])

    // Simulate the J-PAKE protocol exchange
    const aliceRound1 = aliceWOtherInfo.round1()
    bobWOtherInfo.round1()

    // Expect an error when Bob tries to process Alice's round1 result with a different timestamp
    expect(() =>
      bobWOtherInfo.round2(aliceRound1, s, aliceWOtherInfo.userId),
    ).toThrow('ZKP verification failed')
  })

  it('should successfully complete a key exchange when s > n', () => {
    const largeS = 10n * n + 1n // s is larger than n
    const aliceWithLargeS = new JPake('AliceWithLargeS')
    const bobWithLargeS = new JPake('BobWithLargeS')

    // Simulate the J-PAKE protocol exchange
    const aliceRound1 = aliceWithLargeS.round1()
    const bobRound1 = bobWithLargeS.round1()

    const aliceRound2 = aliceWithLargeS.round2(
      bobRound1,
      largeS,
      bobWithLargeS.userId,
    )
    const bobRound2 = bobWithLargeS.round2(
      aliceRound1,
      largeS,
      aliceWithLargeS.userId,
    )

    aliceWithLargeS.setRound2ResultFromBob(bobRound2)
    bobWithLargeS.setRound2ResultFromBob(aliceRound2)

    // Derive and compare the shared keys
    const aliceSharedKey = aliceWithLargeS.deriveSharedKey()
    const bobSharedKey = bobWithLargeS.deriveSharedKey()

    expect(aliceSharedKey).toEqual(bobSharedKey)
  })

  it('should throw error when s = 0 or s mod n = 0', () => {
    alice.round1()
    const bobRound1 = bob.round1()

    // Test when s = 0
    expect(() => alice.round2(bobRound1, 0n, bob.userId)).toThrow(
      'Invalid s: s MUST not be equal to 0 mod n',
    )

    // Test when s mod n = 0
    const largeS = n * 2n // s is a multiple of n
    expect(() => alice.round2(bobRound1, largeS, bob.userId)).toThrow(
      'Invalid s: s MUST not be equal to 0 mod n',
    )
  })

  it('should throw an error when receiving invalid points', () => {
    const alice = new JPake('Alice')
    alice.round1()

    const invalidRound1Result = {
      G1: {} as ProjPointType<bigint>, // Invalid G1
      G2: {} as ProjPointType<bigint>, // Invalid G2
      ZKPx1: new Uint8Array(32),
      ZKPx2: new Uint8Array(32),
    }

    expect(() => alice.round2(invalidRound1Result, BigInt(123), 'Bob')).toThrow(
      'Invalid points received: G1 or G2 is not a valid ProjectivePoint',
    )
  })
})
