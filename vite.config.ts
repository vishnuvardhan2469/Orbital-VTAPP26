import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const root = import.meta.dirname

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      // satellite.js's pthreads WASM build cannot be bundled; see the stub for
      // the full explanation and how to re-enable it.
      '#wasm-multi-thread': path.resolve(root, './src/lib/orbit/wasm-multi-thread-stub.ts'),
    },
  },
  // Honour PORT so the dev server can be assigned a free port by tooling.
  server: { port: Number(process.env.PORT ?? 5180) },
})
