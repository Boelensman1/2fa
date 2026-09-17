import { describe, it, expect } from 'vitest'

import { positionMenu, MIN_MENU_WIDTH } from '../../lib/content/positionMenu'

/** A roomy desktop viewport, so each test only varies what it is about. */
const viewport = { width: 1280, height: 800 }
const menu = { width: 320, height: 200 }

describe('positionMenu', () => {
  it('places the menu below the field when there is room', () => {
    const result = positionMenu({
      anchor: { top: 100, left: 40, width: 300, height: 32 },
      viewport,
      menu,
    })

    expect(result.placement).toBe('below')
    expect(result.top).toBe(100 + 32 + 4)
    expect(result.left).toBe(40)
  })

  it('flips above when the field is near the bottom', () => {
    const result = positionMenu({
      anchor: { top: 700, left: 40, width: 300, height: 32 },
      viewport,
      menu,
    })

    expect(result.placement).toBe('above')
    expect(result.top).toBe(700 - 4 - 200)
  })

  /**
   * The case the frame policy makes routine rather than exotic: a hosted
   * second-factor widget in its own small iframe. `position: fixed` resolves
   * against that frame's viewport, so there is nowhere to put a 200px menu.
   */
  it('overlaps the field when the frame is too short for either', () => {
    const result = positionMenu({
      anchor: { top: 14, left: 10, width: 300, height: 32 },
      viewport: { width: 320, height: 60 },
      menu,
    })

    expect(result.placement).toBe('over')
    expect(result.top).toBe(0)
  })

  it('keeps the menu inside the left edge', () => {
    const result = positionMenu({
      anchor: { top: 100, left: -50, width: 300, height: 32 },
      viewport,
      menu,
    })

    expect(result.left).toBe(8)
  })

  it('keeps the menu inside the right edge', () => {
    const result = positionMenu({
      anchor: { top: 100, left: 1200, width: 300, height: 32 },
      viewport,
      menu,
    })

    expect(result.left).toBe(1280 - 300 - 8)
  })

  it('is never narrower than the readable minimum', () => {
    const result = positionMenu({
      anchor: { top: 100, left: 40, width: 60, height: 32 },
      viewport,
      menu,
    })

    expect(result.width).toBe(MIN_MENU_WIDTH)
  })

  it('matches a field wider than the minimum', () => {
    const result = positionMenu({
      anchor: { top: 100, left: 40, width: 420, height: 32 },
      viewport,
      menu,
    })

    expect(result.width).toBe(420)
  })

  it('never exceeds a viewport narrower than the minimum width', () => {
    const result = positionMenu({
      anchor: { top: 10, left: 0, width: 300, height: 32 },
      viewport: { width: 200, height: 400 },
      menu,
    })

    expect(result.width).toBe(200 - 16)
    expect(result.left).toBe(8)
  })
})
