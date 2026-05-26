import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Integrate Progressive Web App support to enable standalone installation and offline operations
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Aesthetic Task Planner',
        short_name: 'AestheticPlanner',
        description: 'Lightweight local-first task planner with custom Git-like cloud syncing.',
        theme_color: '#12131a',
        background_color: '#12131a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ],
        shortcuts: [
          {
            name: 'Create New Task',
            short_name: 'New Task',
            description: 'Launch directly into the create task form',
            url: '/?action=new-task',
            icons: [{ src: 'favicon.svg', sizes: '192x192', type: 'image/svg+xml' }]
          },
          {
            name: 'Cloud Pull Sync',
            short_name: 'Pull Sync',
            description: 'Trigger visual cloud diff and pull comparison',
            url: '/?action=pull',
            icons: [{ src: 'favicon.svg', sizes: '192x192', type: 'image/svg+xml' }]
          }
        ]
      }
    })
  ]
})

