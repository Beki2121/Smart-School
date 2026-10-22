import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      },
      manifest: {
        name: 'SmartSchool SIMS',
        short_name: 'SIMS',
        description: 'Bilingual school information management',
        theme_color: '#f5f7f8',
        background_color: '#f5f7f8',
        display: 'standalone',
        start_url: '/',
        icons: []
      },
      devOptions: { enabled: false }
    })
  ],
  server: { host: true, port: 5174, allowedHosts: true, strictPort: false },
  preview: { host: true }
});
