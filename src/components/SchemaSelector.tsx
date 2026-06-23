import type { SelectHTMLAttributes } from 'react'
import type { UseRime } from '../hooks/useRime'
import { useResolvedRime } from './context'

export interface SchemaSelectorProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  /** RIME instance. Omit to use the surrounding <RimeProvider>. */
  rime?: UseRime
}

/** Unstyled <select> for switching input schemas, including grouped options. */
export function SchemaSelector({ rime, ...rest }: SchemaSelectorProps) {
  const r = useResolvedRime(rime)
  return (
    <select
      value={r.schema}
      onChange={(e) => void r.setSchema(e.target.value)}
      {...rest}
    >
      {r.schemas.map((opt) =>
        'children' in opt ? (
          <optgroup key={opt.key} label={opt.label}>
            {opt.children.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ),
      )}
    </select>
  )
}
