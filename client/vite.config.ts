import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/collab': {
        target: 'ws://127.0.0.1:1234',
        ws: true,
        rewriteWsOrigin: true
      }
    }
  }
})
