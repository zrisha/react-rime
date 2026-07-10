import {
  createContext,
  createElement,
  useContext,
  type PropsWithChildren,
} from 'react'
import { useRime, type UseRime, type UseRimeOptions } from './hooks/useRime'

const RimeContext = createContext<UseRime | null>(null)

/**
 * Creates one RIME engine and shares it with descendant components via
 * context ({@link useRimeContext}) — one engine for an editor plus its status
 * bar, toolbar, etc. Optional: `useRime()` works standalone for single-input
 * cases. Exactly one input under the provider should spread `getInputProps()`.
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
