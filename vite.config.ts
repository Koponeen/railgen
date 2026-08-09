import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Preact omistaa UI-kromin; SVG-kartta ja ele-engine ovat oma imperatiivinen
// saareke sen ulkopuolella (docs/IMPLEMENTATION_PLAN.md luku 2).
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  test: {
    environment: 'node',
  },
})
