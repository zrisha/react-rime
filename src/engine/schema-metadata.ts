// Pure, framework-agnostic processing of schemas.json into the metadata the UI
// layer needs (select options, per-schema variants, comment-hiding rules).
// Extracted from my_rime's control.ts module scope.

import type { RimeLanguage } from './types'
import { getLanguage } from './locale'
import schemas from '../schemas.json'

export const SIMPLIFICATION = 'simplification'

export type Variant = { id: string; name: string; value: boolean }
export type Variants = { id: string; name: string; languages?: RimeLanguage[] }[]
export type HideComment = boolean | 'emoji'

export type SelectOption =
  | { label: string; value: string }
  | {
      type: 'group'
      label: string
      key: string
      children: { label: string; value: string }[]
    }

export interface SchemaMetadata {
  selectOptions: SelectOption[]
  variants: Record<string, Variant[]>
  variantsDefaultIndex: Record<string, number>
  comment: Record<string, HideComment>
  extended: string[]
  ids: string[]
}

type RawSchema = {
  id: string
  name: string
  group?: string
  disabled?: boolean
  hideComment?: HideComment
  extended?: boolean
  variants?: Variants
  family?: { id: string; name: string; disabled?: boolean; variants?: Variants }[]
}

function getDefaultVariantIndex(variants: Variants | undefined, language: RimeLanguage): number {
  if (variants) {
    for (let i = 0; i < variants.length; ++i) {
      if (variants[i].languages?.includes(language)) return i
    }
    return 0
  }
  return ['zh-HK', 'zh-TW'].includes(language) ? 1 : 0
}

function convertVariants(variants: Variants | undefined): Variant[] {
  if (variants) {
    if (variants.length) {
      return variants.map((v) => ({ ...v, value: true }))
    }
    return [{ id: '', name: '', value: true }]
  }
  return [
    { id: SIMPLIFICATION, name: '简', value: true },
    { id: SIMPLIFICATION, name: '繁', value: false },
  ]
}

/** Builds schema metadata once. Pure: same input → same output. */
export function buildSchemaMetadata(language: RimeLanguage = getLanguage()): SchemaMetadata {
  const selectOptions: SelectOption[] = []
  const variants: Record<string, Variant[]> = {}
  const variantsDefaultIndex: Record<string, number> = {}
  const comment: Record<string, HideComment> = {}
  const extended: string[] = []
  const ids: string[] = []

  function register(
    id: string,
    name: string,
    group: string | undefined,
    isExtended: boolean | undefined,
    hideComment: HideComment | undefined,
    schemaVariants: Variants | undefined,
  ) {
    const item = { label: name, value: id }
    if (group) {
      let found = false
      for (const opt of selectOptions) {
        if ('children' in opt && opt.label === group) {
          opt.children.push(item)
          found = true
          break
        }
      }
      if (!found) {
        selectOptions.push({ type: 'group', label: group, key: group, children: [item] })
      }
    } else {
      selectOptions.push(item)
    }
    variantsDefaultIndex[id] = getDefaultVariantIndex(schemaVariants, language)
    variants[id] = convertVariants(schemaVariants)
    if (isExtended) extended.push(id)
    if (hideComment) comment[id] = hideComment
    ids.push(id)
  }

  for (const schema of schemas as RawSchema[]) {
    if (schema.disabled) continue
    register(schema.id, schema.name, schema.group, schema.extended, schema.hideComment, schema.variants)
    if (schema.family) {
      for (const { id, name, disabled, variants: familyVariants } of schema.family) {
        if (disabled) continue
        register(id, name, schema.group, schema.extended, schema.hideComment, familyVariants ?? schema.variants)
      }
    }
  }

  return { selectOptions, variants, variantsDefaultIndex, comment, extended, ids }
}

/** The id of the first (default) schema, e.g. "luna_pinyin". */
export const DEFAULT_SCHEMA_ID = (schemas as RawSchema[])[0].id
