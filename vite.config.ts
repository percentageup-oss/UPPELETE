import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*', '**/.tools/**'],
  },
  build: {
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
})
