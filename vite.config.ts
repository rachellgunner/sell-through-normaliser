import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works when served from a GitHub Pages
// project subpath (e.g. https://<user>.github.io/<repo>/) without
// needing to hardcode the repo name here.
export default defineConfig({
  base: './',
  plugins: [react()],
})
