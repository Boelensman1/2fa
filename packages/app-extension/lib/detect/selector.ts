/**
 * Ways of naming a detected field to a human.
 *
 * Three of them, because they answer different questions.
 * {@link cssPathFor} is a path worth *saving* as an entry's `inputSelector`,
 * so it refuses ids that will not survive the next render.
 * {@link describeElement} is a devtools-style label for *reading*, so it
 * keeps exactly those ids. {@link shadowHostPathFor} supplies the part a css
 * path cannot express, since no selector syntax crosses a shadow boundary.
 *
 * None of them is for re-finding the element in code: a handle holds the
 * element directly, and a path built from `nth-of-type` goes stale the next
 * time the page renders. That is why none of this needs to be perfect and
 * none of it should be gold-plated.
 * @module
 */

/** How many ancestors a generated path will name before giving up. */
const MAX_PATH_DEPTH = 8

/**
 * Ids that a framework generated and that will differ on the next render.
 *
 * React's `useId` emits `:r1:`; several others append a bare counter. Saving
 * one of those as an `inputSelector` gives the user a selector that works
 * once and then silently never matches again.
 */
const UNSTABLE_ID_RE = /^[:_]|[:]|^[a-z]*[-_]?\d+$|^(?:radix|headlessui|mui)-/i

/**
 * Whether an id is worth building a selector from.
 * @param id - The element's id.
 * @returns Whether it looks author-written and stable.
 */
export const isStableId = (id: string): boolean =>
  id !== '' && !UNSTABLE_ID_RE.test(id)

const escapeIdent = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/([^\w-])/g, '\\$1')

/**
 * Builds a css path to an element.
 *
 * Prefers a stable id, then a `name` within a form, then a positional path.
 * The path stops at the containing shadow root rather than trying to cross
 * it, because no `querySelector` syntax pierces a shadow boundary anyway --
 * `::part` and the old `>>>` are not selector syntax for this purpose.
 * @param element - The element to describe.
 * @returns A selector that resolves to the element within its own root.
 */
export const cssPathFor = (element: Element): string => {
  if (isStableId(element.id)) return `#${escapeIdent(element.id)}`

  const name = element.getAttribute('name')
  if (name !== null && name !== '') {
    const tag = element.tagName.toLowerCase()
    return `${tag}[name="${name.replace(/(["\\])/g, '\\$1')}"]`
  }

  const segments: string[] = []
  let current: Element | null = element
  while (current !== null && segments.length < MAX_PATH_DEPTH) {
    if (isStableId(current.id)) {
      segments.unshift(`#${escapeIdent(current.id)}`)
      break
    }

    const tag = current.tagName.toLowerCase()
    const parent: Element | null = current.parentElement
    if (parent === null) {
      segments.unshift(tag)
      break
    }

    const sameTag = [...parent.children].filter(
      (sibling) => sibling.tagName === current?.tagName,
    )
    segments.unshift(
      sameTag.length > 1
        ? `${tag}:nth-of-type(${String(sameTag.indexOf(current) + 1)})`
        : tag,
    )
    current = parent
  }

  return segments.join(' > ')
}

/** How many class names a description lists before it truncates. */
const MAX_DESCRIBED_CLASSES = 3

/** How long any one attribute value may be in a description. */
const MAX_DESCRIBED_VALUE = 32

const truncate = (value: string): string =>
  value.length > MAX_DESCRIBED_VALUE
    ? `${value.slice(0, MAX_DESCRIBED_VALUE - 1)}…`
    : value

/**
 * Attributes worth naming when pointing a human at an element.
 *
 * `placeholder` and `aria-label` earn their place by being the only two that
 * are usually visible on screen, so they are what turns a report into "that
 * box, there". `type` is here because a masked otp box looks like a password
 * field and the reader needs to know that is what they are looking at.
 */
const DESCRIBED_ATTRIBUTES = ['type', 'name', 'placeholder', 'aria-label']

/**
 * A devtools-style one-line description of an element.
 *
 * A *label*, not a selector: it uses the raw id even when
 * {@link isStableId} rejects it, and truncates long values. That is the
 * point -- a framework-generated `:r1:` is useless in a saved
 * `inputSelector` but is the fastest way to find the element in the console
 * right now, which is the only job this has.
 * @param element - The element to describe.
 * @returns Something like `input#code.form-control[name="otp"]`.
 */
export const describeElement = (element: Element): string => {
  let description = element.tagName.toLowerCase()

  if (element.id !== '') description += `#${element.id}`

  const classes = [...element.classList]
  for (const name of classes.slice(0, MAX_DESCRIBED_CLASSES)) {
    description += `.${name}`
  }
  if (classes.length > MAX_DESCRIBED_CLASSES) description += '.…'

  for (const attribute of DESCRIBED_ATTRIBUTES) {
    const value = element.getAttribute(attribute)
    if (value === null || value === '') continue
    description += `[${attribute}="${truncate(value)}"]`
  }

  return description
}

/**
 * The chain of shadow hosts between an element and the document.
 *
 * {@link cssPathFor} deliberately stops at the containing root, which leaves
 * a field inside a web component described by a selector that
 * `document.querySelector` will never match. This is the missing half: with
 * both, the reader can walk down by hand --
 * `document.querySelector(host).shadowRoot.querySelector(path)`.
 * @param element - The element to locate.
 * @returns Host paths outermost-first, or `null` if it is in the document.
 */
export const shadowHostPathFor = (element: Element): string | null => {
  const hosts: string[] = []

  let root = element.getRootNode()
  while (root instanceof ShadowRoot && hosts.length < MAX_PATH_DEPTH) {
    hosts.unshift(cssPathFor(root.host))
    root = root.host.getRootNode()
  }

  return hosts.length > 0 ? hosts.join(' >> ') : null
}
