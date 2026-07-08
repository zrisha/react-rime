import { forwardRef, type TextareaHTMLAttributes } from 'react'
import type { UseRime } from '../hooks/useRime'
import { useResolvedRime } from './context'

export interface RimeTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  /** RIME instance. Omit to use the surrounding <RimeProvider>. */
  rime?: UseRime
}

/**
 * Unstyled textarea wired to the RIME engine: forwards key events for
 * composition and binds the committed-text buffer. Bring your own styling.
 */
export const RimeTextarea = forwardRef<HTMLTextAreaElement, RimeTextareaProps>(
  function RimeTextarea({ rime, onKeyDown, onKeyUp, ...rest }, ref) {
    const r = useResolvedRime(rime)
    return (
      <textarea
        {...r.getInputProps<HTMLTextAreaElement>({ ref, onKeyDown, onKeyUp })}
        {...rest}
      />
    )
  },
)
