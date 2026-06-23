// Maps DOM KeyboardEvents to RIME key strings.
// Logic extracted verbatim from my_rime's MyPanel.vue; no framework deps.

export const RIME_KEY_MAP: { [key: string]: string | undefined } = {
  Escape: 'Escape',
  F4: 'F4',
  Backspace: 'BackSpace',
  Delete: 'Delete',
  Tab: 'Tab',
  Enter: 'Return',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  Alt: 'Alt_L',
  ArrowUp: 'Up',
  ArrowRight: 'Right',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  '~': 'asciitilde',
  '`': 'quoteleft',
  '!': 'exclam',
  '@': 'at',
  '#': 'numbersign',
  $: 'dollar',
  '%': 'percent',
  '^': 'asciicircum',
  '&': 'ampersand',
  '*': 'asterisk',
  '(': 'parenleft',
  ')': 'parenright',
  '-': 'minus',
  _: 'underscore',
  '+': 'plus',
  '=': 'equal',
  '{': 'braceleft',
  '[': 'bracketleft',
  '}': 'braceright',
  ']': 'bracketright',
  ':': 'colon',
  ';': 'semicolon',
  '"': 'quotedbl',
  "'": 'apostrophe',
  '|': 'bar',
  '\\': 'backslash',
  '<': 'less',
  ',': 'comma',
  '>': 'greater',
  '.': 'period',
  '?': 'question',
  '/': 'slash',
  ' ': 'space',
}

// Control+key combos are normally suppressed, except these pass through to RIME.
const CONTROL_ALLOWLIST = ['`']

export function isPrintable(key: string): boolean {
  return /^[a-z0-9!"#$%&'()*+,./:;<=>?@[\] ^_`{|}~\\-]$/i.test(key)
}

function wrap(s: string): string {
  return `{${s}}`
}

/**
 * Translates a DOM keydown event into a RIME key string.
 * Returns null for keys that should be ignored (standalone modifiers,
 * unrecognised shortcuts, etc.).
 */
export function toRimeKey(e: KeyboardEvent): string | null {
  const { code, key } = e

  if (key === 'Shift' || key === 'Control' || key === 'Meta') {
    return null
  }

  const isPrintableKey = isPrintable(key)
  const isAlt = key === 'Alt'
  const hasControl = e.getModifierState('Control')
  const hasMeta = e.getModifierState('Meta')
  const hasAlt = e.getModifierState('Alt')
  const hasShift = e.getModifierState('Shift')
  const isShortcut = hasControl || hasMeta || hasAlt || (hasShift && !isPrintableKey)

  let rimeKey: string | undefined

  if (isShortcut || !isPrintableKey) {
    rimeKey = /^[0-9a-z]$/i.test(key) ? key : RIME_KEY_MAP[key]
    if (rimeKey === undefined) {
      return null
    }
    if (isAlt && code === 'AltRight') {
      rimeKey = 'Alt_R'
    }
    // Reject Control+x unless explicitly allowed.
    if (hasControl && isPrintableKey && !CONTROL_ALLOWLIST.includes(key) && !hasMeta && !hasAlt) {
      return null
    }
    const modifiers: string[] = []
    if (hasControl) modifiers.push('Control')
    if (hasMeta) modifiers.push('Meta')
    if (hasAlt && !isAlt) modifiers.push('Alt')
    if (hasShift) modifiers.push('Shift')
    modifiers.push(rimeKey)
    return wrap(modifiers.join('+'))
  } else if (code.startsWith('Numpad')) {
    return wrap(`KP_${code.substring(6)}`)
  } else {
    return key
  }
}

/**
 * Translates a DOM keyup event into a RIME Release key string.
 * Returns null if the key should not generate a release event.
 */
export function toRimeKeyRelease(e: KeyboardEvent): string | null {
  const { key } = e
  const mapped = RIME_KEY_MAP[key] || key
  return wrap(`Release+${mapped}`)
}
