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

  // The option-name lookups take arbitrary strings (consumer-supplied for
  // setOption, engine-supplied for syncOptions), so they must not resolve
  // Object.prototype members to something that looks like a tracked cell.
  it('treats Object.prototype keys as untracked option names', async () => {
    const engine = makeEngine()
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.setOption('constructor', true)
    })
    expect(engine.setOption).toHaveBeenCalledWith('constructor', true)
    expect(result.current.options.constructor).toBeUndefined()

    act(() => result.current.syncOptions(['toString']))
    act(() => result.current.syncOptions(['!hasOwnProperty']))
    expect(result.current.options.toString).toBeUndefined()
  })
})

// Minimal in-memory stand-in for the worker's Emscripten FS. A `null` value
// marks a directory; anything else is a file's contents.
const S_IFDIR = 0o040000
const S_IFREG = 0o100000

function makeFS(tree: Record<string, string | null>) {
  const nodes = new Map<string, string | null>(Object.entries(tree))
  return {
    nodes,
    readFile: vi.fn(async (path: string) => {
      const value = nodes.get(path)
      if (value == null) throw new Error(`ENOENT: ${path}`)
      return value
    }),
    writeFile: vi.fn(async (path: string, data: string) => {
      nodes.set(path, data)
    }),
    readdir: vi.fn(async (path: string) => {
      if (nodes.get(path) !== null) throw new Error(`ENOTDIR: ${path}`)
      const prefix = `${path}/`
      const names = new Set<string>()
      for (const key of nodes.keys()) {
        if (!key.startsWith(prefix)) continue
        names.add(key.slice(prefix.length).split('/')[0])
      }
      return ['.', '..', ...names]
    }),
    lstat: vi.fn(async (path: string) => {
      if (!nodes.has(path)) throw new Error(`ENOENT: ${path}`)
      return { mode: nodes.get(path) === null ? S_IFDIR : S_IFREG }
    }),
    unlink: vi.fn(async (path: string) => {
      nodes.delete(path)
    }),
    rmdir: vi.fn(async (path: string) => {
      nodes.delete(path)
    }),
  }
}

const SCHEMA_PATH = '/usr/share/rime-data/build/luna_pinyin.schema.yaml'
const LEARNING_ON = 'engine:\n  translators:\n    - script_translator\ntranslator:\n  dictionary: luna_pinyin\n'

describe('useImeControl userDict', () => {
  it('rewrites the compiled schema and re-selects so librime re-reads it', async () => {
    const fs = makeFS({ [SCHEMA_PATH]: LEARNING_ON, '/rime': null })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect(fs.nodes.get(SCHEMA_PATH)).toContain('enable_user_dict: false')
    // The first setIME is what downloads the schema; the second one is the
    // reload that actually takes the patch into effect.
    expect(engine.setIME).toHaveBeenCalledTimes(2)
  })

  it('deletes a user dictionary the first activation already created', async () => {
    const fs = makeFS({
      [SCHEMA_PATH]: LEARNING_ON,
      '/rime': null,
      '/rime/luna_pinyin.userdb': null,
      '/rime/luna_pinyin.userdb/LOCK': '',
      '/rime/luna_pinyin.userdb/MANIFEST-000004': 'x',
      '/rime/user.yaml': 'var:\n',
    })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect([...fs.nodes.keys()].filter((k) => k.includes('userdb'))).toEqual([])
    // consumer-deployed files and RIME's own config are left alone
    expect(fs.nodes.has('/rime/user.yaml')).toBe(true)
  })

  it('does not rewrite a schema that already ships with learning off', async () => {
    const fs = makeFS({
      [SCHEMA_PATH]: 'engine:\n  translators:\n    - script_translator\ntranslator:\n  enable_user_dict: false\n',
      '/rime': null,
    })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect(fs.writeFile).not.toHaveBeenCalled()
    // Re-selecting a second time is a no-op: nothing to patch, sweep already done.
    engine.setIME = vi.fn(async () => {})
    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })
    expect(engine.setIME).toHaveBeenCalledTimes(1)
  })

  it('leaves the filesystem alone by default (learning stays on)', async () => {
    const fs = makeFS({ [SCHEMA_PATH]: LEARNING_ON, '/rime': null })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect(fs.readFile).not.toHaveBeenCalled()
    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(engine.setIME).toHaveBeenCalledTimes(1)
  })

  it('sweeps dictionaries an earlier session left behind, even with nothing to patch', async () => {
    // ipa_xsampa and ipa_yunlong ship with learning already off, so the rewrite
    // is a no-op — but a userdb another schema built last session is still on
    // disk, and this sweep is the only thing that reaches it.
    const fs = makeFS({
      [SCHEMA_PATH]: 'engine:\n  translators:\n    - script_translator\ntranslator:\n  enable_user_dict: false\n',
      '/rime': null,
      '/rime/luna_pinyin.userdb': null,
      '/rime/luna_pinyin.userdb/CURRENT': 'x',
    })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect([...fs.nodes.keys()].filter((k) => k.includes('userdb'))).toEqual([])
    // and re-selected, so the deletion is flushed to IndexedDB
    expect(engine.setIME).toHaveBeenCalledTimes(2)
  })

  it('sweeps once per engine, not on every schema switch', async () => {
    const fs = makeFS({
      [SCHEMA_PATH]: LEARNING_ON,
      '/usr/share/rime-data/build/wubi86.schema.yaml': 'engine:\n  translators:\n    - table_translator\ntranslator:\n  enable_user_dict: false\n',
      '/rime': null,
    })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })
    fs.readdir.mockClear()
    await act(async () => {
      await result.current.selectIME('wubi86')
    })

    // wubi86 needs no rewrite and the sweep already ran, so /rime is untouched
    expect(fs.readdir).not.toHaveBeenCalled()
  })

  it('warns rather than silently leaving learning on for an unparseable schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fs = makeFS({ [SCHEMA_PATH]: 'engine: {translators: [script_translator]}\n', '/rime': null })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    await act(async () => {
      await result.current.selectIME('luna_pinyin')
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('was not understood'))
    expect(fs.writeFile).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns rather than silently leaving learning on for a self-deployed schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fs = makeFS({ '/rime': null }) // no compiled yaml for this schema
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine, { userDict: false }))

    // A distinct schema id: devWarn dedupes per key for the life of the module,
    // and the unparseable-schema case above already burned luna_pinyin's.
    await act(async () => {
      await result.current.selectIME('terra_pinyin')
    })

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('userDict: false could not be applied'))
    warn.mockRestore()
  })
})

describe('useImeControl clearLearned', () => {
  it('removes every user dictionary and re-selects to flush the deletion', async () => {
    const fs = makeFS({
      '/rime': null,
      '/rime/luna_pinyin.userdb': null,
      '/rime/luna_pinyin.userdb/LOCK': '',
      '/rime/stroke.userdb': null,
      '/rime/stroke.userdb/CURRENT': 'x',
      '/rime/user.yaml': 'var:\n',
      '/rime/my_schema.schema.yaml': 'custom',
    })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await result.current.clearLearned()
    })

    expect([...fs.nodes.keys()].filter((k) => k.includes('userdb'))).toEqual([])
    // a consumer's own deployed schema survives — unlike resetUserDirectory
    expect(fs.nodes.has('/rime/my_schema.schema.yaml')).toBe(true)
    expect(engine.setIME).toHaveBeenCalled()
  })

  it('gates input before touching the filesystem', async () => {
    // A commit landing mid-sweep triggers the worker's syncfs and would flush a
    // half-deleted database, so `loading` must be true before the first unlink.
    let loadingAtFirstFsCall: boolean | undefined
    const fs = makeFS({ '/rime': null, '/rime/luna_pinyin.userdb': null })
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine))
    fs.readdir.mockImplementation(async () => {
      loadingAtFirstFsCall ??= result.current.loading
      return ['.', '..']
    })

    await act(async () => {
      await result.current.clearLearned()
    })

    expect(loadingAtFirstFsCall).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it('surfaces a mid-sweep failure instead of leaving loading stuck', async () => {
    // A failure partway through leaves a partially deleted database; the caller
    // has to hear about it rather than see a silent success.
    const fs = makeFS({
      '/rime': null,
      '/rime/luna_pinyin.userdb': null,
      '/rime/luna_pinyin.userdb/CURRENT': 'x',
    })
    fs.unlink.mockRejectedValue(new Error('boom'))
    const engine = makeEngine({ FS: fs as unknown as RimeEngine['FS'] })
    const { result } = renderHook(() => useImeControl(engine))

    await act(async () => {
      await expect(result.current.clearLearned()).rejects.toThrow('boom')
    })
    expect(result.current.loading).toBe(false)
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
