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
  function RimeTextarea({ rime, onKeyDown, onKeyUp, ...rest }, _ref) {
    const r = useResolvedRime(rime)
    return (
      <textarea
        ref={r.inputRef as React.RefObject<HTMLTextAreaElement>}
        value={r.text}
        onChange={(e) => r.setText(e.target.value)}
        onKeyDown={(e) => {
          r.onKeyDown(e)
          onKeyDown?.(e)
        }}
        onKeyUp={(e) => {
          r.onKeyUp(e)
          onKeyUp?.(e)
        }}
        {...rest}
      />
    )
  },
)
