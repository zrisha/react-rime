import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // react-rime is linked via file:..; let Vite pre-bundle it from source-built dist.
  optimizeDeps: { include: ['react-rime'] },
})
