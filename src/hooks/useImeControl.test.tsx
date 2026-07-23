import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useImeControl } from './useImeControl'
import type { RimeEngine } from '../engine/engine'

function makeEngine(overrides: Partial<RimeEngine> = {}): RimeEngine {
  return {
    setIME: vi.fn(async () => {}),
    setOption: vi.fn(async () => {}),
    setPageSize: vi.fn(async () => {}),
    deploy: vi.fn(async () => {}),
    process: vi.fn(async () => ({ state: 3 })),
    selectCandidateOnCurrentPage: vi.fn(async () => ''),
    changePage: vi.fn(async () => ''),
    resetUserDirectory: vi.fn(async () => {}),
    FS: {} as RimeEngine['FS'],
    onDeployStatus: () => {},
    dispose: () => {},
    ...overrides,
  } as RimeEngine
}

beforeEach(() => {
  localStorage.clear()
})

describe('useImeControl selectIME', () => {
  it('activates the schema and re-syncs options', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect(engine.setIME).toHaveBeenCalledWith('luna_pinyin')
    expect(result.current.schemaId).toBe('luna_pinyin')
    expect(result.current.loading).toBe(false)
    // Basic options are re-sent after a switch (all except ascii_mode).
    const options = (engine.setOption as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(options).toContain('full_shape')
    expect(options).toContain('emoji_suggestion')
    expect(options).not.toContain('ascii_mode')
    expect(result.current.isEnglish).toBe(false)
  })

  it('sets ime to the NEW schema id after a switch (stale-closure regression)', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })
    await act(async () => {
      await result.current.selectIME('double_pinyin')
    })
    expect(result.current.ime).toBe('double_pinyin')
    expect(result.current.schemaId).toBe('double_pinyin')
  })

  it('rethrows engine failures and clears loading', async () => {
    const engine = makeEngine({
      setIME: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await expect(result.current.selectIME('luna_pinyin')).rejects.toThrow('network down')
    })
    expect(result.current.loading).toBe(false)
  })

  it('tolerates schema ids missing from the bundled metadata', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('my_custom_schema')
    })
    expect(result.current.schemaId).toBe('my_custom_schema')

    // No variants known: changeVariant must be a safe no-op.
    await act(async () => {
      await result.current.changeVariant()
    })
    expect(result.current.variants).toEqual([])
  })
})

describe('useImeControl variants', () => {
  it('cycles 简/繁 and pushes the option to the engine', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })
    expect(result.current.variant?.name).toBe('简')

    await act(async () => {
      await result.current.changeVariant()
    })
    expect(result.current.variant?.name).toBe('繁')
    expect(engine.setOption).toHaveBeenCalledWith('simplification', false)

    await act(async () => {
      await result.current.changeVariant()
    })
    expect(result.current.variant?.name).toBe('简')
    expect(engine.setOption).toHaveBeenCalledWith('simplification', true)
  })
})

describe('useImeControl syncOptions', () => {
  it('applies single-option updates from the engine', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    act(() => {
      result.current.syncOptions(['ascii_mode'])
    })
    expect(result.current.isEnglish).toBe(true)

    act(() => {
      result.current.syncOptions(['!ascii_mode'])
    })
    expect(result.current.isEnglish).toBe(false)

    act(() => {
      result.current.syncOptions(['full_shape'])
    })
    expect(result.current.isFullWidth).toBe(true)
  })

  it('resolves the active variant from multi-option updates', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })
    expect(result.current.variant?.name).toBe('简')

    // Deploy-style bulk update naming the 繁 variant's option... the default
    // 简/繁 pair shares one option id, so drive the deployed=true branch off.
    act(() => {
      result.current.setDeployed(true)
    })
    act(() => {
      result.current.syncOptions(['simplification', 'other_flag'])
    })
    expect(result.current.variant?.name).toBe('简')
  })
})

describe('useImeControl generic setOption', () => {
  it('sets a tracked option by name and mirrors it into state + options bag', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.setOption('full_shape', true)
    })
    expect(engine.setOption).toHaveBeenCalledWith('full_shape', true)
    expect(result.current.isFullWidth).toBe(true)
    expect(result.current.options.full_shape).toBe(true)
  })

  it('reaches an untracked option without wiring (escape hatch)', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.setOption('some_custom_option', true)
    })
    expect(engine.setOption).toHaveBeenCalledWith('some_custom_option', true)
    // Untracked options aren't reflected in the bag.
    expect(result.current.options.some_custom_option).toBeUndefined()
  })
})

describe('useImeControl persistence', () => {
  it('persists toggled options to localStorage', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.changeWidth()
    })
    expect(result.current.isFullWidth).toBe(true)
    expect(localStorage.getItem('full_shape')).toBe('true')

    // A fresh hook instance picks the saved value up.
    const { result: second } = renderHook(() => useImeControl(engine))
    expect(second.current.isFullWidth).toBe(true)
  })
})
