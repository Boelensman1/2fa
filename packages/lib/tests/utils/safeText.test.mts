import { describe, it, expect } from 'vitest'

import {
  containsUnsafeText,
  MAX_LOG_MESSAGE_LENGTH,
  sanitiseForDisplay,
} from '../../src/utils/safeText.mjs'

describe('sanitiseForDisplay', () => {
  it('leaves an ordinary string alone', () => {
    expect(sanitiseForDisplay('work laptop', 48)).toBe('work laptop')
  })

  it('removes the characters that can repaint a terminal line', () => {
    // A carriage return hides everything printed before it and an ESC starts an
    // ANSI sequence, so a device name holding either can rewrite the line its
    // fingerprint was printed on. What is left of the sequence is inert text.
    const cleaned = sanitiseForDisplay('safe\r[2Kevil', 48)
    // Asserted through the predicate the two reporting boundaries use, rather
    // than a second copy of the same character class kept in step by hand.
    expect(containsUnsafeText(cleaned)).toBe(false)
    expect(cleaned).toContain('safe')
    expect(cleaned).toContain('[2Kevil')
  })

  it('removes bidi and zero-width formatting', () => {
    // A bidi override reorders the digits of the fingerprint the user is being
    // asked to compare -- the one part of the message worth trusting.
    const cleaned = sanitiseForDisplay('a‮b​c﻿', 48)
    expect(containsUnsafeText(cleaned)).toBe(false)
    expect(cleaned).toBe('abc')
  })

  it('keeps a zero-width joiner, so an emoji name survives', () => {
    // U+200D is the one invisible character with a legitimate use here: it is
    // what holds a multi-codepoint emoji together, and a name is allowed to be
    // an emoji.
    const emoji = '\u{1F469}‍\u{1F4BB}'
    expect(sanitiseForDisplay(emoji, 48)).toBe(emoji)
  })

  it('collapses the whitespace a stripped run leaves behind', () => {
    // A tab becomes a space rather than nothing, so that removing one from
    // `a<tab>b` leaves two words -- and then the run of spaces collapses.
    expect(sanitiseForDisplay('a\t\n  b', 48)).toBe('a b')
    expect(sanitiseForDisplay('  padded  ', 48)).toBe('padded')
  })

  it('truncates within the budget, ellipsis included', () => {
    const cleaned = sanitiseForDisplay('x'.repeat(256), 48)
    expect(cleaned).toHaveLength(48)
    expect(cleaned.endsWith('…')).toBe(true)
  })

  it('does not truncate a string that exactly fits', () => {
    expect(sanitiseForDisplay('x'.repeat(48), 48)).toBe('x'.repeat(48))
  })

  it('bounds a log message at a readable length', () => {
    // Several 256-character peer-supplied fields can land in one sentence, and
    // a log event is one line by contract.
    expect(
      sanitiseForDisplay('x'.repeat(8192), MAX_LOG_MESSAGE_LENGTH),
    ).toHaveLength(MAX_LOG_MESSAGE_LENGTH)
  })
})

describe('containsUnsafeText', () => {
  it('is false for text that only needs tidying', () => {
    // A wrapped error message is ordinary, and reporting one as evidence of
    // something would make the report worthless.
    expect(containsUnsafeText('a plain message')).toBe(false)
    expect(containsUnsafeText('wrapped\n\tmessage')).toBe(false)
    expect(containsUnsafeText('n'.repeat(4096))).toBe(false)
  })

  it('is true for the characters that rewrite what a user reads', () => {
    expect(containsUnsafeText('a\rb')).toBe(true)
    expect(containsUnsafeText('a\u001bb')).toBe(true)
    expect(containsUnsafeText('a\u0000b')).toBe(true)
    expect(containsUnsafeText('a\u202Eb')).toBe(true)
    expect(containsUnsafeText('a\u200Bb')).toBe(true)
  })

  it('is false for a zero-width joiner', () => {
    expect(containsUnsafeText('\u{1F469}\u200D\u{1F4BB}')).toBe(false)
  })
})
