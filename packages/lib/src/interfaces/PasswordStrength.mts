/**
 * What `getPasswordStrength` returns: a score out of 4, an estimate of how
 * many guesses the password would take, and zxcvbn's feedback about why it
 * scored what it did.
 *
 * Deliberately not zxcvbn's own result type. That object also carries the
 * match sequences, crack-time estimates and the password itself, none of which
 * any client reads -- and naming it here would put `@zxcvbn-ts/core` into
 * favalib's public types, making a consumer depend on it just to type a call.
 */
export interface PasswordStrength {
  /** 0-4. favalib refuses any vault or export password scoring below 3. */
  score: number
  /** log10 of zxcvbn's estimated number of guesses. */
  guessesLog10: number
  feedback: {
    /** Why the password is weak, or null when zxcvbn has nothing to say. */
    warning: string | null
    suggestions: string[]
  }
}
