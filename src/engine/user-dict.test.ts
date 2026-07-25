import { describe, it, expect } from 'vitest'
import { dictTranslatorNamespaces, disableUserDict } from './user-dict'

// Fixtures mirror the shape of the compiled schemas @rime-contrib ships (2-space
// indent, alphabetized keys, quoted `@namespace` entries) and each case below
// was observed in a sweep of all 32 bundled schemas.

// luna_pinyin: one dict-backed translator plus a read-only custom phrase table.
const LUNA = `custom_phrase:
  db_class: stabledb
  dictionary: ""
  user_dict: custom_phrase
engine:
  filters:
    - uniquifier
  translators:
    - punct_translator
    - "table_translator@custom_phrase"
    - reverse_lookup_translator
    - script_translator
translator:
  dictionary: luna_pinyin
  enable_sentence: true
`

// jyut6ping3: reverse-lookup namespaces each open their own user dictionary,
// which is why patching `translator` alone is not enough.
const JYUT = `cangjie5:
  dictionary: cangjie5
  enable_user_dict: false
engine:
  translators:
    - punct_translator
    - script_translator
    - "script_translator@luna_pinyin"
    - "script_translator@loengfan"
    - "table_translator@stroke"
    - "table_translator@cangjie5"
loengfan:
  dictionary: loengfan
  tag: loengfan
luna_pinyin:
  dictionary: luna_pinyin
  tag: luna_pinyin
stroke:
  dictionary: stroke
  tag: stroke
translator:
  dictionary: jyut6ping3
`

describe('dictTranslatorNamespaces', () => {
  it('maps bare and @-suffixed dict translators to their config blocks', () => {
    expect(dictTranslatorNamespaces(LUNA)).toEqual(['custom_phrase', 'translator'])
    expect(dictTranslatorNamespaces(JYUT)).toEqual([
      'translator',
      'luna_pinyin',
      'loengfan',
      'stroke',
      'cangjie5',
    ])
  })

  it('ignores translators with no dictionary behind them', () => {
    // punct_translator and reverse_lookup_translator never open a user dict.
    expect(dictTranslatorNamespaces(LUNA)).not.toContain('punct_translator')
    expect(dictTranslatorNamespaces(LUNA)).not.toContain('reverse_lookup_translator')
  })

  it('returns nothing when there is no engine block', () => {
    expect(dictTranslatorNamespaces('translator:\n  dictionary: x\n')).toEqual([])
  })
})

describe('disableUserDict', () => {
  it('disables the main translator', () => {
    expect(disableUserDict(LUNA)).toContain('translator:\n  enable_user_dict: false')
  })

  it('leaves read-only phrase tables alone', () => {
    // custom_phrase is an author-supplied list on a stabledb, not learned text;
    // disabling it would silently drop the custom-phrase feature.
    const out = disableUserDict(LUNA)
    expect(out).toContain('custom_phrase:\n  db_class: stabledb')
    expect(out).not.toContain('custom_phrase:\n  enable_user_dict: false')
  })

  it('disables every reverse-lookup namespace, not just the main one', () => {
    const out = disableUserDict(JYUT)
    for (const ns of ['translator', 'luna_pinyin', 'loengfan', 'stroke']) {
      expect(out).toContain(`${ns}:\n  enable_user_dict: false`)
    }
  })

  it('is idempotent, which is how callers detect "already patched"', () => {
    const once = disableUserDict(JYUT)
    expect(disableUserDict(once)).toBe(once)
    // a schema that already ships fully disabled is returned untouched
    const off = 'engine:\n  translators:\n    - script_translator\ntranslator:\n  enable_user_dict: false\n'
    expect(disableUserDict(off)).toBe(off)
  })

  it('rewrites an explicit enable_user_dict: true', () => {
    const on = 'engine:\n  translators:\n    - script_translator\ntranslator:\n  enable_user_dict: true\n'
    expect(disableUserDict(on)).toContain('enable_user_dict: false')
    expect(disableUserDict(on)).not.toContain('enable_user_dict: true')
  })

  it('writes a block for a namespace that has none (librime would default it on)', () => {
    const missing = 'engine:\n  translators:\n    - "script_translator@extra"\n'
    expect(disableUserDict(missing)).toContain('extra:\n  enable_user_dict: false')
  })

  it('survives CRLF, preserving the line endings', () => {
    const crlf = LUNA.replace(/\n/g, '\r\n')
    const out = disableUserDict(crlf)
    expect(out).toContain('translator:\r\n  enable_user_dict: false')
    expect(out).not.toContain('\n\n')
  })

  it('handles a trailing comment on a translator entry', () => {
    // A `break` on the first non-matching line would drop every translator
    // after this one, silently leaving their user dictionaries enabled.
    const commented = `engine:
  translators:
    - script_translator  # the main one
    - "script_translator@extra"
extra:
  dictionary: x
translator:
  dictionary: y
`
    expect(dictTranslatorNamespaces(commented)).toEqual(['translator', 'extra'])
    expect(disableUserDict(commented)).toContain('extra:\n  enable_user_dict: false')
  })

  it('handles a block sequence indented at its key', () => {
    const flush = `engine:
  translators:
  - script_translator
translator:
  dictionary: y
`
    expect(dictTranslatorNamespaces(flush)).toEqual(['translator'])
  })

  it('matches the block indentation instead of assuming two spaces', () => {
    // Inserting a 2-space key above a 4-space body produces invalid YAML,
    // which librime refuses to load — worse than not patching at all.
    const wide = `engine:
    translators:
        - script_translator
translator:
    dictionary: y
`
    expect(disableUserDict(wide)).toContain('translator:\n    enable_user_dict: false')
  })

  it('respects a quoted db_class', () => {
    const quoted = `engine:
  translators:
    - "table_translator@custom_phrase"
custom_phrase:
  db_class: "stabledb"
  user_dict: custom_phrase
`
    expect(disableUserDict(quoted)).toBe(quoted)
  })

  it('finds a quoted block key rather than appending a duplicate', () => {
    const quotedKey = `engine:
  translators:
    - script_translator
"translator":
  dictionary: y
`
    const out = disableUserDict(quotedKey)
    expect(out).toContain('"translator":\n  enable_user_dict: false')
    // a second, unquoted `translator:` key would be ambiguous to the parser
    expect(out).not.toMatch(/^translator:$/m)
  })

  it('reports nothing understood rather than guessing', () => {
    // Flow style: not something librime emits, but the caller must be able to
    // tell "no translators" from "learning is off".
    expect(dictTranslatorNamespaces('engine: {translators: [script_translator]}\n')).toEqual([])
  })

  it('does not touch a nested enable_user_dict belonging to a sub-key', () => {
    const nested = `engine:
  translators:
    - script_translator
translator:
  dictionary: x
  something:
    enable_user_dict: true
`
    const out = disableUserDict(nested)
    // the sub-key keeps its value; the namespace gets its own top-level key
    expect(out).toContain('    enable_user_dict: true')
    expect(out).toContain('translator:\n  enable_user_dict: false')
  })
})
