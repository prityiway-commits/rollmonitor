import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir:    'dist',
    sourcemap: false,
    // Split chunks to prevent one huge JS file from crashing the browser
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          charts:  ['chart.js', 'react-chartjs-2'],
          ui:      ['react-hot-toast', 'react-datepicker', 'date-fns'],
          aws:     ['axios'],
        },
      },
    },
  },
})
