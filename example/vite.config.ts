import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const lib = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// `npm run dev` serves the library from ../src for instant HMR while editing
// react-rime itself. `vite build` (and therefore the Playwright smoke test)
// consumes the built package from ../dist like a real consumer would.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves the demo from /<repo>/ (set by the deploy workflow).
  base: process.env.EXAMPLE_BASE ?? '/',
  ...(command === 'serve'
    ? {
        resolve: {
          alias: { 'react-rime': lib('../src/index.ts') },
          // The library source resolves deps from ../node_modules; force a
          // single React instance or hooks break with two copies.
          dedupe: ['react', 'react-dom'],
        },
        server: { fs: { allow: [lib('..')] } },
      }
    : {
        // react-rime is linked via file:..; let Vite pre-bundle it from dist.
        optimizeDeps: { include: ['react-rime'] },
      }),
}))
