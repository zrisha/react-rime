// react-rime — headless React hooks for the RIME input-method engine.

// Primary hook
export { useRime } from './hooks/useRime'
export type {
  UseRime,
  UseRimeOptions,
  RimeInputProps,
  RimeInputPropsOverrides,
} from './hooks/useRime'

// Focused hooks (advanced)
export { useImeControl } from './hooks/useImeControl'
export type { ImeControl, UseImeControlOptions } from './hooks/useImeControl'

// Optional context for sharing one engine across components
export { RimeProvider, useRimeContext } from './context'

// Engine layer (for custom integrations)
export {
  createRimeEngine,
  DEFAULT_WORKER_URL,
  type RimeEngine,
  type RimeEngineOptions,
} from './engine/engine'
export { toRimeKey, toRimeKeyRelease, isPrintable, RIME_KEY_MAP } from './engine/rimeKeys'
export { getLanguage } from './engine/locale'
export { SCHEMA_IDS, type SchemaId } from './engine/schema-ids'
export {
  buildSchemaMetadata,
  DEFAULT_SCHEMA_ID,
  type SchemaMetadata,
  type SelectOption,
  type Variant,
  type HideComment,
} from './engine/schema-metadata'

// Types
export type {
  RimeResult,
  RimeCommitted,
  RimeAccepted,
  RimeRejected,
  RimeUnhandled,
  RimeCandidate,
  RimeLanguage,
  Preedit,
} from './engine/types'
