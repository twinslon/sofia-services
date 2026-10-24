import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // The prepared GTFS extracts live in public/data and are copied as-is
    assetsInlineLimit: 0,
  },
})
