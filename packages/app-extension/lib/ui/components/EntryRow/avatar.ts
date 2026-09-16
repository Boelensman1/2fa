import type { ListedEntry } from '@/lib/types'

/** A stable colour per issuer, so rows stay recognisable between openings. */
const AVATAR_COLOURS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-600',
]

/**
 * Picks an entry's avatar colour.
 *
 * Shared with the inline menu rather than duplicated: the same entry showing
 * blue in the popup and amber on the page would read as two different items.
 * @param seed - The issuer, or the name when there is no issuer.
 * @returns A tailwind background class.
 */
export const avatarColour = (seed: string) => {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

export const initial = (entry: ListedEntry) =>
  (entry.issuer || entry.name || '?').trim().charAt(0).toUpperCase() || '?'
