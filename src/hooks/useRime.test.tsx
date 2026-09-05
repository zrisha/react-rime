import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

// Shared, hoisted handle so the test can drive the fake engine.
const h = vi.hoisted(() => ({
  deployHandler: null as null | ((status: string, schemas: string[]) => void),
  processImpl: (_key: string): any => ({ state: 3 }),
  selectImpl: (_i: number): string => JSON.stringify({ state: 0, committed: '' }),
  setPageSize: vi.fn(async () => {}),
  setOption: vi.fn(async () => {}),
  changePage: vi.fn(async () => JSON.stringify({ state: 3 })),
}))

vi.mock('../engine/engine', () => {
  const engine = {
    setIME: vi.fn(async () => {}),
    setOption: h.setOption,
    setPageSize: h.setPageSize,
    deploy: vi.fn(async () => {}),
    process: vi.fn(async (k: string) => h.processImpl(k)),
    selectCandidateOnCurrentPage: vi.fn(async (i: number) => h.selectImpl(i)),
    changePage: h.changePage,
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

type SpyKeyboardEvent = KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> }

function kbd(key: string, code: string): SpyKeyboardEvent {
  return {
    key,
    code,
    preventDefault: vi.fn(),
    getModifierState() {
      return false
    },
  } as unknown as SpyKeyboardEvent
}

describe('useRime composition', () => {
  beforeEach(() => {
    h.deployHandler = null
    h.processImpl = () => ({ state: 3 })
    h.selectImpl = () => JSON.stringify({ state: 0, committed: '' })
    h.setPageSize.mockClear()
    h.setOption.mockClear()
  })

  it('becomes ready on deploy success', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))
  })

  it('re-exposes ime/showVariant/options from ImeControl (no silent drop)', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(result.current.ime).toBe(result.current.schema)
    expect(result.current.showVariant).toBe(true)
    expect(typeof result.current.options).toBe('object')
    expect(typeof result.current.setOption).toBe('function')
  })

  it('forwards setOption to the engine (generic escape hatch)', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))
    h.setOption.mockClear()

    await act(async () => {
      await result.current.setOption('ascii_mode', true)
    })
    expect(h.setOption).toHaveBeenCalledWith('ascii_mode', true)
    expect(result.current.isEnglish).toBe(true)
    expect(result.current.options.ascii_mode).toBe(true)
  })

  it('applies pageSize once the engine is created', async () => {
    const { result } = renderHook(() => useRime({ pageSize: 9 }))
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(h.setPageSize).toHaveBeenCalledTimes(1)
    expect(h.setPageSize).toHaveBeenCalledWith(9)
  })

  it('re-applies pageSize when it changes', async () => {
    const { result, rerender } = renderHook(({ pageSize }) => useRime({ pageSize }), {
      initialProps: { pageSize: 9 },
    })
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(h.setPageSize).toHaveBeenCalledTimes(1)

    rerender({ pageSize: 5 })

    await waitFor(() => expect(h.setPageSize).toHaveBeenCalledTimes(2))
    expect(h.setPageSize).toHaveBeenLastCalledWith(5)
  })

  // 0 is the engine's "unset" sentinel: the wasm-side page_size override falls
  // back to the schema's own menu/page_size (my_rime's librime patch).
  it('resets to the schema default when pageSize is removed', async () => {
    const { result, rerender } = renderHook(
      ({ pageSize }: { pageSize?: number }) => useRime({ pageSize }),
      { initialProps: { pageSize: 9 as number | undefined } },
    )
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(h.setPageSize).toHaveBeenLastCalledWith(9)

    rerender({ pageSize: undefined })

    await waitFor(() => expect(h.setPageSize).toHaveBeenCalledTimes(2))
    expect(h.setPageSize).toHaveBeenLastCalledWith(0)

    // No custom size is in effect anymore, so no further resets either.
    rerender({ pageSize: undefined })
    expect(h.setPageSize).toHaveBeenCalledTimes(2)
  })

  it('does not call setPageSize when the option is omitted', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(h.deployHandler).not.toBeNull())
    act(() => h.deployHandler!('success', []))
    await waitFor(() => expect(result.current.ready).toBe(true))

    expect(h.setPageSize).not.toHaveBeenCalled()
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

  // engine.setIME resets the session, so a composition started under the old
  // schema is already dead in the engine. Leaving it on screen meant the panel
  // showed dead candidates until some later interaction (e.g. paging) happened
  // to clear it.
  it('clears the composition when the schema changes', async () => {
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
    expect(result.current.candidates).toHaveLength(2)

    await act(async () => {
      await result.current.setSchema('wubi86')
    })

    expect(result.current.composing).toBe(false)
    expect(result.current.candidates).toHaveLength(0)
    expect(result.current.preedit).toEqual({ head: '', body: '', tail: '' })
    expect(result.current.schema).toBe('wubi86')
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

  it('leaves editing keys alone when not composing (native Backspace)', async () => {
    const process = vi.fn((): any => ({ state: 3 }))
    h.processImpl = process
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const e = kbd('Backspace', 'Backspace')
    await act(async () => {
      result.current.onKeyDown(e)
    })
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(process).not.toHaveBeenCalled()
  })

  it('routes Backspace to RIME while composing', async () => {
    const seen: string[] = []
    h.processImpl = (key) => {
      seen.push(key)
      return {
        state: 1,
        head: '',
        body: 'n',
        tail: '',
        page: 0,
        isLastPage: true,
        highlighted: 0,
        candidates: [{ text: '你' }],
      }
    }
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })
    const e = kbd('Backspace', 'Backspace')
    await act(async () => {
      result.current.onKeyDown(e)
    })
    expect(e.preventDefault).toHaveBeenCalled()
    expect(seen).toContain('{BackSpace}')
  })

  it('cancelComposition discards the preedit via Escape', async () => {
    const seen: string[] = []
    h.processImpl = (key) => {
      seen.push(key)
      if (key === '{Escape}') return { state: 2 }
      return {
        state: 1,
        head: '',
        body: 'n',
        tail: '',
        page: 0,
        isLastPage: true,
        highlighted: 0,
        candidates: [{ text: '你' }],
      }
    }
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })
    expect(result.current.composing).toBe(true)

    await act(async () => {
      await result.current.cancelComposition()
    })
    expect(seen).toContain('{Escape}')
    expect(result.current.composing).toBe(false)
    expect(result.current.text).toBe('')
  })

  it('commitHighlighted commits via Space', async () => {
    h.processImpl = (key) => {
      if (key === ' ') return { state: 0, committed: '你' }
      return {
        state: 1,
        head: '',
        body: 'n',
        tail: '',
        page: 0,
        isLastPage: true,
        highlighted: 0,
        candidates: [{ text: '你' }],
      }
    }
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })
    await act(async () => {
      await result.current.commitHighlighted()
    })
    expect(result.current.text).toBe('你')
    expect(result.current.composing).toBe(false)
  })

  it('composition actions are no-ops when not composing', async () => {
    const process = vi.fn((): any => ({ state: 3 }))
    h.processImpl = process
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.cancelComposition()
      await result.current.commitHighlighted()
      await result.current.highlightNext()
    })
    expect(process).not.toHaveBeenCalled()
  })

  it('getInputProps wires value, onChange, and key handling', async () => {
    h.processImpl = () => ({ state: 3 })
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const consumerKeyDown = vi.fn()
    const props = result.current.getInputProps({ onKeyDown: consumerKeyDown })
    expect(props.value).toBe('')
    expect(props.autoCapitalize).toBe('off')
    expect(props.autoCorrect).toBe('off')
    expect(props.autoComplete).toBe('off')
    expect(props.spellCheck).toBe(false)

    await act(async () => {
      props.onChange({ target: { value: 'abc' } } as React.ChangeEvent<HTMLTextAreaElement>)
    })
    expect(result.current.text).toBe('abc')

    await act(async () => {
      props.onKeyDown(kbd('x', 'KeyX') as unknown as React.KeyboardEvent<HTMLTextAreaElement>)
    })
    expect(result.current.text).toBe('abcx')
    expect(consumerKeyDown).toHaveBeenCalled()
  })

  it('getCandidateProps suppresses pointerdown focus-steal and wires onClick to selectCandidate', async () => {
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
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })

    const props = result.current.getCandidateProps(0)
    const preventDefault = vi.fn()
    props.onPointerDown({ preventDefault } as unknown as React.PointerEvent)
    expect(preventDefault).toHaveBeenCalled()

    await act(async () => {
      props.onClick()
    })
    expect(result.current.text).toBe('你')
  })

  describe('refocus fallback', () => {
    const calls: string[] = []
    let textarea: HTMLTextAreaElement
    let button: HTMLButtonElement
    let focusSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      calls.length = 0
      h.processImpl = (key) => {
        calls.push(`process:${key}`)
        return {
          state: 1,
          head: '',
          body: 'n',
          tail: '',
          page: 0,
          isLastPage: true,
          highlighted: 0,
          candidates: [{ text: '你' }],
        }
      }
      h.selectImpl = () => {
        calls.push('select')
        return JSON.stringify({ state: 0, committed: '你' })
      }
      h.changePage.mockImplementation(async () => {
        calls.push('change')
        return JSON.stringify({ state: 3 })
      })
      const realFocus = HTMLElement.prototype.focus
      focusSpy = vi
        .spyOn(HTMLElement.prototype, 'focus')
        .mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
          calls.push(`focus:${this.tagName}`)
          realFocus.call(this, opts)
        })
      // jsdom's focus() only works on attached elements.
      textarea = document.createElement('textarea')
      button = document.createElement('button')
      document.body.append(textarea, button)
    })
    afterEach(() => {
      focusSpy.mockRestore()
      h.changePage.mockImplementation(async () => JSON.stringify({ state: 3 }))
      textarea.remove()
      button.remove()
    })

    async function setup() {
      const { result } = renderHook(() => useRime())
      await waitFor(() => expect(result.current.ready).toBe(true))
      result.current.getInputProps().ref(textarea)
      const compose = () =>
        act(async () => {
          textarea.value = result.current.text
          result.current.onKeyDown(kbd('n', 'KeyN'))
        })
      return { result, compose }
    }

    it('is a no-op when the input already has focus (the getCandidateProps path)', async () => {
      const { result, compose } = await setup()
      await compose()
      textarea.focus()
      calls.length = 0
      await act(async () => {
        await result.current.selectCandidate(0)
      })
      expect(calls).toEqual(['select'])
    })

    it('refocuses synchronously, after posting the engine call, when a button took focus', async () => {
      const { result, compose } = await setup()
      await compose()
      button.focus()
      calls.length = 0
      // Not awaited yet: everything below must have happened synchronously,
      // i.e. still inside the click's user gesture — and the engine message
      // must already be queued ahead of anything the refocus triggers.
      const pending = result.current.selectCandidate(0)
      expect(calls).toEqual(['select', 'focus:TEXTAREA'])
      expect(focusSpy).toHaveBeenLastCalledWith({ preventScroll: true })
      expect(document.activeElement).toBe(textarea)
      await act(async () => {
        await pending
      })
      expect(result.current.text).toBe('你')

      button.focus()
      calls.length = 0
      const paging = result.current.changePage(false)
      expect(calls).toEqual(['change', 'focus:TEXTAREA'])
      await act(async () => {
        await paging
      })
    })

    it('keeps a cancel-on-blur handler from getting ahead of the selection', async () => {
      const { result, compose } = await setup()
      button.addEventListener('blur', () => void result.current.cancelComposition())
      await compose()
      button.focus()
      calls.length = 0
      await act(async () => {
        await result.current.selectCandidate(0)
      })
      expect(calls).toEqual(['select', 'focus:TEXTAREA', 'process:{Escape}'])
      expect(result.current.text).toBe('你')
    })

    it('commits at the caret captured before the refocus, not where a focus handler moved it', async () => {
      const { result, compose } = await setup()
      textarea.addEventListener('focus', () => textarea.select())
      act(() => {
        result.current.setText('ab')
      })
      await compose()
      textarea.selectionStart = textarea.selectionEnd = 1
      button.focus()
      await act(async () => {
        await result.current.selectCandidate(0)
      })
      expect(result.current.text).toBe('a你b')
    })
  })

  it('getPagingProps suppresses pointerdown focus-steal and wires onClick to changePage', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const props = result.current.getPagingProps(true)
    const preventDefault = vi.fn()
    props.onPointerDown({ preventDefault } as unknown as React.PointerEvent)
    expect(preventDefault).toHaveBeenCalled()

    await act(async () => {
      props.onClick()
    })
    expect(h.changePage).toHaveBeenLastCalledWith(true)
  })

  it('returns identity-stable functions across state changes', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const first = result.current
    act(() => {
      result.current.setText('force a state change')
    })
    const second = result.current
    expect(second).not.toBe(first) // state changed, object identity should too
    expect(second.onKeyDown).toBe(first.onKeyDown)
    expect(second.onKeyUp).toBe(first.onKeyUp)
    expect(second.selectCandidate).toBe(first.selectCandidate)
    expect(second.changePage).toBe(first.changePage)
    expect(second.getCandidateProps).toBe(first.getCandidateProps)
    expect(second.getPagingProps).toBe(first.getPagingProps)
    expect(second.setSchema).toBe(first.setSchema)
    expect(second.changeLanguage).toBe(first.changeLanguage)
    expect(second.changeVariant).toBe(first.changeVariant)
    expect(second.cancelComposition).toBe(first.cancelComposition)
    expect(second.setText).toBe(first.setText)
  })

  it('does not toggle on a bare Shift tap unless enableShiftToggle is set', async () => {
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.isEnglish).toBe(false)

    await act(async () => {
      result.current.onKeyDown(kbd('Shift', 'ShiftLeft'))
      result.current.onKeyUp(kbd('Shift', 'ShiftLeft'))
    })
    expect(result.current.isEnglish).toBe(false)
  })

  it('toggles English mode on a bare Shift tap, but not around other keys', async () => {
    const { result } = renderHook(() => useRime({ enableShiftToggle: true }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.isEnglish).toBe(false)

    await act(async () => {
      result.current.onKeyDown(kbd('Shift', 'ShiftLeft'))
      result.current.onKeyUp(kbd('Shift', 'ShiftLeft'))
    })
    await waitFor(() => expect(result.current.isEnglish).toBe(true))

    // Shift used as a modifier (another key pressed in between) must not toggle.
    await act(async () => {
      result.current.onKeyDown(kbd('Shift', 'ShiftLeft'))
      result.current.onKeyDown(kbd('a', 'KeyA'))
      result.current.onKeyUp(kbd('Shift', 'ShiftLeft'))
    })
    expect(result.current.isEnglish).toBe(true)
  })
})

describe('useRime clearLearned', () => {
  beforeEach(() => {
    h.processImpl = () => ({ state: 3 })
  })

  it('drops the composition, like any other schema re-selection', async () => {
    // clearLearned re-selects the schema, which resets the librime session and
    // kills the composition in the engine — leaving the preedit on screen would
    // show candidates that no longer do anything.
    h.processImpl = (key) =>
      key === 'n'
        ? {
            state: 1,
            head: '',
            body: 'n',
            tail: '',
            page: 0,
            isLastPage: true,
            highlighted: 0,
            candidates: [{ text: '你' }],
          }
        : { state: 3 }
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      result.current.onKeyDown(kbd('n', 'KeyN'))
    })
    expect(result.current.composing).toBe(true)

    await act(async () => {
      await result.current.clearLearned()
    })
    expect(result.current.composing).toBe(false)
    expect(result.current.candidates).toEqual([])
  })

  it('surfaces failures through rime.error rather than rejecting', async () => {
    // The documented usage is <button onClick={rime.clearLearned}>, which has
    // nowhere to catch a rejection — an unhandled one would be the only signal.
    const { result } = renderHook(() => useRime())
    await waitFor(() => expect(result.current.ready).toBe(true))

    const { createRimeEngine } = await import('../engine/engine')
    const engine = await createRimeEngine()
    vi.mocked(engine.setIME).mockRejectedValueOnce(new Error('disk gone'))

    await act(async () => {
      await expect(result.current.clearLearned()).resolves.toBeUndefined()
    })
    expect(result.current.error?.message).toBe('disk gone')
  })
})
