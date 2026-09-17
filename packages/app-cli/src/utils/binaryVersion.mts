import { readFileSync } from 'node:fs'

/**
 * favacli's own version, read from its package.json rather than written as a
 * literal, which drifts silently on a version bump.
 *
 * Lives here, rather than in main.mts, because the `version` command needs the
 * same number and the path to the package root is relative to whichever file
 * resolves it. src/utils/ and build/utils/ sit at the same depth, so this one
 * URL covers both tsx and the compiled build.
 */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }

export default version
