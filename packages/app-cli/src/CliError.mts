/**
 * An error whose message is the whole report.
 *
 * Clipanion prints a thrown error's stack unless the error carries a
 * `clipanion` property, and a stack is the right thing for a bug and the wrong
 * thing for "the sync server did not answer": the trace points at whichever
 * line noticed, which is never where the problem is, and it buries the sentence
 * that says what to do. Setting `clipanion` to an empty object (no `type:
 * 'usage'`) gets the name and message printed and nothing else.
 */
class CliError extends Error {
  readonly clipanion = {}

  /**
   * @param message - The whole report, in sentences.
   * @param name - Printed before it, spaced out at its capitals by clipanion;
   * plain `Error` would come out as "Internal Error".
   */
  constructor(message: string, name = 'FavaCliError') {
    super(message)
    this.name = name
  }
}

export default CliError
