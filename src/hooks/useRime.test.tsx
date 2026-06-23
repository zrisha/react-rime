import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// Shared, hoisted handle so the test can drive the fake engine.
const h = vi.hoisted(() => ({
  deployHandler: null as null | ((status: string, schemas: string[]) => void),
  processImpl: (_key: string): any => ({ state: 3 }),
  selectImpl: (_i: number): string => JSON.stringify({ state: 0, committed: '' }),
}))

vi.mock('../engine/engine', () => {
  const engine = {
    setIME: vi.fn(async () => {}),
    setOption: vi.fn(async () => {}),
    setPageSize: vi.fn(async () => {}),
    deploy: vi.fn(async () => {}),
    process: vi.fn(async (k: string) => h.processImpl(k)),
    selectCandidateOnCurrentPage: vi.fn(async (i: number) => h.selectImpl(i)),
    changePage: vi.fn(async () => JSON.stringify({ state: 3 })),
    resetUserDirectory: vi.fn(async () => {}),
    FS: {},
    onDeployStatus: (cb: (s: string, sc: string[]) => void) => {
      h.deployHandler = cb
    },
    dispose: vi.fn(),
  }
  return {
    createRimeEngine: vi.fn(async () => engine),
    DEFAULT_WORKER_URL: 'mock',
  }
})

import { useRime } from './useRime'

function kbd(key: string, code: string): KeyboardEvent {
  return {
    key,
    code,
    preventDefault() {},
    getModifierState() {
      return false
    },
  } as unknown as KeyboardEvent
}

describe('useRime composition', () => {
  beforeEach(() => {
    h.deployHandler = null
    h.processImpl = () => ({ state: 3 })
    h.selectImpl = () => JSON.stringify({ state: 0, committed: '' })
  })

  it('becomes ready on deploy success', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('enters composition and exposes candidates (ACCEPTED)', async () => {
    h.processImpl = () => ({
      state: 1,
      head: '',
      body: 'n',
      tail: '',
      page: 0,
      isLastPage: true,
      highlighted: 0,
      candidates: [{ text: '你' }, { text: '尼' }],
    })
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })

    expect(result.current.composing).toBe(true)
    expect(result.current.candidates.map((c) => c.text)).toEqual(['你', '尼'])
    expect(result.current.preedit.body).toBe('n')
  })

  it('commits a candidate to the text buffer (COMMITTED)', async () => {
    h.processImpl = () => ({
      state: 1,
      head: '',
      body: 'n',
      tail: '',
      page: 0,
      isLastPage: true,
      highlighted: 0,
      candidates: [{ text: '你' }, { text: '尼' }],
    })
    h.selectImpl = (i) => JSON.stringify({ state: 0, committed: i === 0 ? '你' : '尼' })

    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })
    await act(async () => {
      await result.current.selectCandidate(0)
    })

    expect(result.current.text).toBe('你')
    expect(result.current.composing).toBe(false)
    expect(result.current.candidates).toHaveLength(0)
  })

  it('passes through unhandled printable keys (UNHANDLED)', async () => {
    h.processImpl = () => ({ state: 3 })
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('x', 'KeyX'))
    })
    expect(result.current.text).toBe('x')
  })
})
