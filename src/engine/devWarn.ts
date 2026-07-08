// Development-only warnings for common integration mistakes. Each key fires
// once per page load; everything compiles away to a no-op in production.

// Bundlers statically replace process.env.NODE_ENV; this keeps the lib free
// of @types/node while still typechecking the guard.
declare const process: { env: Record<string, string | undefined> } | undefined

const warned = new Set<string>()

export function devWarn(key: string, message: string): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`react-rime: ${message}`)
}
