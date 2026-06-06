import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy vendor libs into their own chunks so the main app bundle
    // shrinks and the browser can cache them independently of our weekly
    // releases. Picks the libs that show up biggest in a `vite build`:
    //   - openlayers: the editor + Live map
    //   - html2canvas: kneeboard PNG rendering
    //   - pptxgenjs:   brief PPTX export
    //   - pdf-lib / pdfjs-dist: brief PDF export
    //   - @anthropic-ai/sdk: BYOK AI client
    // Anything not matched here stays in the main bundle. The result is
    // 5 smaller chunks instead of one 2.2MB monster — same total bytes
    // but they cache better and stream in parallel.
    // Rolldown (Vite 8) wants manualChunks as a function, not an object.
    // We split heavy vendor libs out by package-name match so the main app
    // bundle shrinks and the browser can cache them independently of our
    // weekly app code releases.
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules')) {
            if (id.includes('/ol/') || id.endsWith('/ol')) return 'ol'
            if (id.includes('html2canvas') || id.includes('html-to-image')) return 'imgcap'
            if (id.includes('jszip')) return 'jszip'
            if (id.includes('proj4')) return 'proj4'
            if (id.includes('react-dom') || id.includes('scheduler')) return 'react-dom'
          }
          return undefined
        },
      },
    },
    // Whatever stays in the main bundle is genuinely "app code" — bump
    // the warning ceiling to 1MB so we get a louder signal again only
    // when we add a real new heavyweight, not from baseline app size.
    chunkSizeWarningLimit: 1000,
  },
})
