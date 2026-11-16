import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves a project site at /<repo-name>/; the deploy workflow sets BASE_PATH to that.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Stock List',
        short_name: 'Stock List',
        description: "What you've got, how many and where. Saved in Google Drive.",
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f1f5f9',
        theme_color: '#0d9488',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Everything is bundled and data lives on the device, so precache it all to work offline.
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico}'] },
    }),
  ],
})
