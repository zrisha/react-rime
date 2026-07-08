import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// useLayoutEffect warns when rendered on the server; the assignment only
// matters for client-side event dispatch anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * A stable-identity callback that always invokes the latest render's closure
 * (the useEvent pattern). Everything the hooks return keeps one identity for
 * the component's lifetime, so consumers can memoize freely and effect deps
 * don't churn.
 */
export function useEventCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn)
  useIsomorphicLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
