import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, secure: false },
    },
    // COOP/COEP removidos: eram necessários para Cornerstone3D (SharedArrayBuffer/WASM),
    // mas bloqueiam o iframe do OrthoVis (cross-origin porta 5174).
    // O OrthoVis define seus próprios cabeçalhos quando necessário.
  },
  optimizeDeps: {
    include: [
      '@cornerstonejs/dicom-image-loader',
      '@cornerstonejs/codec-libjpeg-turbo-8bit',
      '@cornerstonejs/codec-openjpeg',
      '@cornerstonejs/codec-openjph',
      '@cornerstonejs/codec-charls',
    ],
  },
  build: {
    outDir:    'dist',
    sourcemap: false,
    // lightningcss (default no Vite 6+) está lançando "Unexpected token Semicolon"
    // em CSS válido vindo do bundle Tailwind expandido. Desabilitar minify de CSS
    // até diagnosticar a regra problemática. Custo: ~30KB a mais não-gzipped.
    cssMinify: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@cornerstonejs/core'))               return 'cs-core';
          if (id.includes('@cornerstonejs/tools'))              return 'cs-tools';
          if (id.includes('@cornerstonejs/dicom-image-loader')) return 'cs-loader';
          if (id.includes('dicom-parser'))                      return 'cs-loader';
          if (id.includes('react-dom'))                         return 'react';
          if (id.includes('react-router'))                      return 'react';
          if (id.includes('@tanstack'))                         return 'query';
        },
      },
    },
  },
})
