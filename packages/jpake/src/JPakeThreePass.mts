import JPake, { Round1Result, Round2Result } from './JPake.mjs'

export type Pass1Result = Round1Result
export interface Pass2Result {
  round1Result: Round1Result
  round2Result: Round2Result
}
export type Pass3Result = Round2Result

class JPakeThreePass {
  private jpake: JPake

  constructor(readonly userId: string) {
    this.jpake = new JPake(this.userId)
  }

  public pass1(): Pass1Result {
    const round1Result = this.jpake.round1()
    return round1Result
  }

  public pass2(
    peerRound1Result: Round1Result,
    s: bigint,
    peerUserId: string,
  ): Pass2Result {
    const round1Result = this.jpake.round1()
    const round2Result = this.jpake.round2(peerRound1Result, s, peerUserId)
    return { round1Result, round2Result }
  }

  public pass3(
    pass2Result: Pass2Result,
    s: bigint,
    peerUserId: string,
  ): Pass3Result {
    const round2Result = this.jpake.round2(
      pass2Result.round1Result,
      s,
      peerUserId,
    )
    this.jpake.setRound2ResultFromBob(pass2Result.round2Result)

    return round2Result
  }

  public receivePass3Results(pass3Result: Pass3Result) {
    this.jpake.setRound2ResultFromBob(pass3Result)
  }

  public deriveSharedKey() {
    return this.jpake.deriveSharedKey()
  }
}

export default JPakeThreePass
