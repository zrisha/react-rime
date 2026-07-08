import { describe, it, expect } from 'vitest'
import { toRimeKey, toRimeKeyRelease, isPrintable } from './rimeKeys'

interface KbdInit {
  key: string
  code?: string
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  shift?: boolean
}

// Minimal KeyboardEvent stand-in: toRimeKey only reads code, key, getModifierState.
function kbd(init: KbdInit): KeyboardEvent {
  const { key, code = '', ctrl, alt, meta, shift } = init
  return {
    key,
    code,
    getModifierState(name: string) {
      switch (name) {
        case 'Control':
          return !!ctrl
        case 'Alt':
          return !!alt
        case 'Meta':
          return !!meta
        case 'Shift':
          return !!shift
        default:
          return false
      }
    },
  } as KeyboardEvent
}

describe('isPrintable', () => {
  it('accepts letters, digits and punctuation', () => {
    expect(isPrintable('a')).toBe(true)
    expect(isPrintable('Z')).toBe(true)
    expect(isPrintable('5')).toBe(true)
    expect(isPrintable('?')).toBe(true)
    expect(isPrintable(' ')).toBe(true)
  })
  it('rejects multi-char and named keys', () => {
    expect(isPrintable('Enter')).toBe(false)
    expect(isPrintable('ab')).toBe(false)
  })
})

describe('toRimeKey', () => {
  it('passes printable keys through verbatim', () => {
    expect(toRimeKey(kbd({ key: 'a', code: 'KeyA' }))).toBe('a')
    expect(toRimeKey(kbd({ key: '5', code: 'Digit5' }))).toBe('5')
  })

  it('ignores standalone modifier keys', () => {
    expect(toRimeKey(kbd({ key: 'Shift' }))).toBeNull()
    expect(toRimeKey(kbd({ key: 'Control' }))).toBeNull()
    expect(toRimeKey(kbd({ key: 'Meta' }))).toBeNull()
  })

  it('maps named keys and wraps them', () => {
    expect(toRimeKey(kbd({ key: 'Enter', code: 'Enter' }))).toBe('{Return}')
    expect(toRimeKey(kbd({ key: 'Backspace', code: 'Backspace' }))).toBe('{BackSpace}')
    expect(toRimeKey(kbd({ key: 'Escape', code: 'Escape' }))).toBe('{Escape}')
    expect(toRimeKey(kbd({ key: 'ArrowLeft', code: 'ArrowLeft' }))).toBe('{Left}')
  })

  it('maps numpad keys to KP_N', () => {
    expect(toRimeKey(kbd({ key: '1', code: 'Numpad1' }))).toBe('{KP_1}')
    expect(toRimeKey(kbd({ key: '0', code: 'Numpad0' }))).toBe('{KP_0}')
  })

  it('forwards Control combinations to RIME while composing', () => {
    expect(toRimeKey(kbd({ key: 'a', code: 'KeyA', ctrl: true }))).toBe('{Control+a}')
    expect(toRimeKey(kbd({ key: '`', code: 'Backquote', ctrl: true }))).toBe('{Control+quoteleft}')
  })

  it('builds modifier prefixes in order', () => {
    expect(toRimeKey(kbd({ key: 'Enter', code: 'Enter', shift: true }))).toBe('{Shift+Return}')
    expect(toRimeKey(kbd({ key: 'a', code: 'KeyA', alt: true }))).toBe('{Alt+a}')
  })

  it('distinguishes right Alt', () => {
    expect(toRimeKey(kbd({ key: 'Alt', code: 'AltRight', alt: true }))).toBe('{Alt_R}')
  })
})

describe('toRimeKey outside a composition (composing = false)', () => {
  it('lets editing and navigation keys keep native behavior', () => {
    expect(toRimeKey(kbd({ key: 'Backspace', code: 'Backspace' }), false)).toBeNull()
    expect(toRimeKey(kbd({ key: 'Enter', code: 'Enter' }), false)).toBeNull()
    expect(toRimeKey(kbd({ key: 'ArrowLeft', code: 'ArrowLeft' }), false)).toBeNull()
    expect(toRimeKey(kbd({ key: 'Home', code: 'Home' }), false)).toBeNull()
  })

  it('lets modifier shortcuts (copy/paste) keep native behavior', () => {
    expect(toRimeKey(kbd({ key: 'c', code: 'KeyC', meta: true }), false)).toBeNull()
    expect(toRimeKey(kbd({ key: 'a', code: 'KeyA', ctrl: true }), false)).toBeNull()
    expect(toRimeKey(kbd({ key: 'v', code: 'KeyV', alt: true }), false)).toBeNull()
  })

  it('still forwards printable keys, F4, and the Control allowlist', () => {
    expect(toRimeKey(kbd({ key: 'n', code: 'KeyN' }), false)).toBe('n')
    expect(toRimeKey(kbd({ key: '?', code: 'Slash', shift: true }), false)).toBe('?')
    expect(toRimeKey(kbd({ key: 'F4', code: 'F4' }), false)).toBe('{F4}')
    expect(toRimeKey(kbd({ key: '`', code: 'Backquote', ctrl: true }), false)).toBe('{Control+quoteleft}')
  })
})

describe('toRimeKeyRelease', () => {
  it('wraps released printable keys', () => {
    expect(toRimeKeyRelease(kbd({ key: 'a' }))).toBe('{Release+a}')
  })
  it('wraps released named keys via the map', () => {
    expect(toRimeKeyRelease(kbd({ key: 'Enter' }))).toBe('{Release+Return}')
    expect(toRimeKeyRelease(kbd({ key: 'Shift' }))).toBe('{Release+Shift}')
  })
})
