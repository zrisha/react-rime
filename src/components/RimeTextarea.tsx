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
        ref={(el) => {
          // RefObject.current is readonly in @types/react 18; the hook's ref
          // is a mutable useRef under the hood.
          ;(r.inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
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
