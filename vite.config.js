import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    open: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  preview: {
    port: 4173,
    open: true,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('read-excel-file') || id.includes('write-excel-file')) return 'vendor-excel'
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react'
            return 'vendor-other'
          }
        }
      }
    },
    chunkSizeWarningLimit: 800
  }
})

