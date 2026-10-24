import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves at /sofia-services/; keep '/' for local dev
  base: process.env.CI ? '/sofia-services/' : '/',
  build: {
    // The prepared GTFS extracts live in public/data and are copied as-is
    assetsInlineLimit: 0,
  },
})
