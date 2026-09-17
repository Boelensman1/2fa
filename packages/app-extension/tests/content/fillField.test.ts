import { describe, it, expect, beforeEach, vi } from 'vitest'

import { fillOtpField } from '../../lib/content/fillField'

/** Runs the segmented loop without waiting for frames that never come. */
const immediately = () => Promise.resolve()

const fill = (elements: readonly HTMLInputElement[], otp: string) =>
  fillOtpField(elements, otp, { nextFrame: immediately })

const inputs = (selector = 'input'): HTMLInputElement[] => [
  ...document.querySelectorAll<HTMLInputElement>(selector),
]

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fillOtpField, single input', () => {
  it('types the code and fires input and change', () => {
    document.body.innerHTML = '<input autocomplete="one-time-code">'
    const [field] = inputs()
    const events: string[] = []
    field?.addEventListener('input', () => events.push('input'))
    field?.addEventListener('change', () => events.push('change'))

    return fill(inputs(), '123456').then((result) => {
      expect(result).toEqual({ filled: true })
      expect(field?.value).toBe('123456')
      expect(events).toEqual(['input', 'change'])
    })
  })

  it('bubbles the events, so a delegated form handler sees them', async () => {
    document.body.innerHTML = '<form><input name="otp"></form>'
    const onInput = vi.fn()
    document.querySelector('form')?.addEventListener('input', onInput)

    await fill(inputs(), '123456')

    expect(onInput).toHaveBeenCalledTimes(1)
  })

  it('fires an InputEvent carrying inputType and data', async () => {
    document.body.innerHTML = '<input>'
    const seen: Event[] = []
    document.querySelector('input')?.addEventListener('input', (event) => {
      seen.push(event)
    })

    await fill(inputs(), '123456')

    const [event] = seen
    expect(event).toBeInstanceOf(InputEvent)
    // Widgets branch on inputType to tell typing from deleting, and read
    // `data` directly -- a plain Event would give them `undefined`.
    expect((event as InputEvent | undefined)?.inputType).toBe('insertText')
    expect((event as InputEvent | undefined)?.data).toBe('123456')
  })

  /**
   * The whole reason the fill goes through the prototype's setter.
   *
   * React installs an own `value` accessor on the node to track changes; a
   * plain assignment goes through it, React concludes nothing changed, and the
   * next render restores the old value. This stands in for that accessor and
   * asserts it was bypassed -- which is exactly what lets React's own listener
   * observe the `input` event that follows.
   */
  it('writes through the prototype setter, not an own accessor', async () => {
    document.body.innerHTML = '<input>'
    const [field] = inputs()
    const ownSetter = vi.fn()
    let tracked = ''
    Object.defineProperty(field, 'value', {
      configurable: true,
      get: () => tracked,
      set: (next: string) => {
        ownSetter(next)
        tracked = next
      },
    })

    await fill(inputs(), '123456')

    expect(ownSetter).not.toHaveBeenCalled()
    // Read off the prototype, since the own getter above shadows the real one.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- ditto
    const { get: real } =
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ?? {}
    expect(real?.call(field)).toBe('123456')
  })

  it('reports an empty code rather than clearing the field', async () => {
    document.body.innerHTML = '<input value="keep">'

    expect(await fill(inputs(), '   ')).toEqual({
      filled: false,
      reason: 'empty-code',
    })
    expect(inputs()[0]?.value).toBe('keep')
  })

  it('reports a field that has been detached', async () => {
    document.body.innerHTML = '<input>'
    const elements = inputs()
    elements[0]?.remove()

    expect(await fill(elements, '123456')).toEqual({
      filled: false,
      reason: 'gone',
    })
  })
})

describe('fillOtpField, segmented row', () => {
  const sixBoxes = (extra = '') =>
    Array.from(
      { length: 6 },
      (_, index) => `<input maxlength="1" name="otp-${String(index)}"${extra}>`,
    ).join('')

  it('writes one character per box, in order', async () => {
    document.body.innerHTML = `<div>${sixBoxes()}</div>`

    const result = await fill(inputs(), '123456')

    expect(result).toEqual({ filled: true })
    expect(inputs().map((input) => input.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })

  it('fires one input event per box', async () => {
    document.body.innerHTML = `<div>${sixBoxes()}</div>`
    const onInput = vi.fn()
    document.querySelector('div')?.addEventListener('input', onInput)

    await fill(inputs(), '123456')

    expect(onInput).toHaveBeenCalledTimes(6)
  })

  /**
   * `isSegmentCandidate` deliberately keeps disabled boxes, because the common
   * widget enables box i+1 only once box i has a value. If the fill hoisted
   * `disabled` out of the loop, or gave up on the first one, five of the six
   * boxes would stay empty.
   */
  it('fills a row that enables each box as the previous one is typed', async () => {
    document.body.innerHTML = `<div>${sixBoxes(' disabled')}</div>`
    const boxes = inputs()
    boxes[0]?.removeAttribute('disabled')
    boxes.forEach((box, index) => {
      box.addEventListener('input', () => {
        boxes[index + 1]?.removeAttribute('disabled')
      })
    })

    const result = await fill(boxes, '123456')

    expect(result).toEqual({ filled: true })
    expect(boxes.map((box) => box.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })

  /**
   * The other widget family: the first box treats a multi-character value as a
   * paste and spreads it across the row itself. Carrying on would write every
   * character a second time and produce 112233.
   */
  it('stops when the widget distributes the code itself', async () => {
    document.body.innerHTML = `<div>${sixBoxes()}</div>`
    const boxes = inputs()
    const onInput = vi.fn()
    boxes[0]?.addEventListener('input', (event) => {
      onInput()
      const typed = (event.target as HTMLInputElement).value
      if (typed.length <= 1) return
      ;[...typed].forEach((character, index) => {
        const box = boxes[index]
        if (box) box.value = character
      })
    })

    // The first box receives the whole code, as a paste-like widget expects.
    const result = await fillOtpField(boxes, '123456', {
      nextFrame: immediately,
    })

    expect(result.filled).toBe(true)
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(boxes.map((box) => box.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
  })

  it('flags a code and a row of different lengths', async () => {
    document.body.innerHTML = `<div>${sixBoxes()}</div>`

    const result = await fill(inputs(), '12345678')

    expect(result).toEqual({ filled: true, reason: 'partial' })
    expect(
      inputs()
        .map((input) => input.value)
        .join(''),
    ).toBe('123456')
  })

  it('reports a row that is torn down mid-fill', async () => {
    document.body.innerHTML = `<div>${sixBoxes()}</div>`
    const boxes = inputs()
    boxes[0]?.addEventListener('input', () => {
      boxes.slice(1).forEach((box) => box.remove())
    })

    expect(await fill(boxes, '123456')).toEqual({
      filled: false,
      reason: 'gone',
    })
  })
})

describe('fillOtpField, submission', () => {
  it('never submits the form and never presses Enter', async () => {
    document.body.innerHTML = '<form><input name="otp"></form>'
    const onSubmit = vi.fn((event: Event) => event.preventDefault())
    const onKey = vi.fn()
    document.querySelector('form')?.addEventListener('submit', onSubmit)
    document.querySelector('form')?.addEventListener('keydown', onKey)

    await fill(inputs(), '123456')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(onKey).not.toHaveBeenCalled()
  })
})
