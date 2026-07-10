// @vitest-environment node
// Server rendering must not touch browser globals: no window, navigator,
// localStorage, or Worker exist here. Locks in the SSR guards in
// getLanguage()/useSavedBoolean(); the engine itself only loads in effects.

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { useRime } from './hooks/useRime'

beforeAll(() => {
  // Node >= 21.2 ships a global navigator; remove it to simulate the older
  // SSR runtimes (Node 18/20) the guards exist for.
  vi.stubGlobal('navigator', undefined)
})

function Editor() {
  const rime = useRime()
  return createElement(
    'div',
    null,
    createElement('textarea', rime.getInputProps()),
    createElement('span', null, rime.ready ? 'ready' : 'loading'),
  )
}

describe('server-side rendering', () => {
  it('renders without browser globals', () => {
    expect(typeof window).toBe('undefined')
    expect(navigator).toBeUndefined()

    const html = renderToString(createElement(Editor))
    expect(html).toContain('<textarea')
    expect(html).toContain('loading')
  })
})
