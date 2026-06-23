import {
  createContext,
  createElement,
  useContext,
  type PropsWithChildren,
} from 'react'
import { useRime, type UseRime, type UseRimeOptions } from '../hooks/useRime'

const RimeContext = createContext<UseRime | null>(null)

/**
 * Creates one RIME engine and shares it with descendant components via context.
 * Optional — `useRime()` works standalone for single-input cases.
 */
export function RimeProvider({ children, ...options }: PropsWithChildren<UseRimeOptions>) {
  const rime = useRime(options)
  return createElement(RimeContext.Provider, { value: rime }, children)
}

/** Access the RIME instance from the nearest `<RimeProvider>`. */
export function useRimeContext(): UseRime {
  const ctx = useContext(RimeContext)
  if (!ctx) {
    throw new Error('react-rime: useRimeContext must be used within <RimeProvider>')
  }
  return ctx
}

/** Resolve a RIME instance from an explicit prop or the surrounding provider. */
export function useResolvedRime(rime?: UseRime): UseRime {
  const ctx = useContext(RimeContext)
  const resolved = rime ?? ctx
  if (!resolved) {
    throw new Error(
      'react-rime: component needs a `rime` prop or a surrounding <RimeProvider>',
    )
  }
  return resolved
}
