import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const envDir = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

  return {
    envDir,
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
          theme_color: '#f4f8fd',
          background_color: '#f4f8fd',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
          ]
        },
        devOptions: { enabled: false }
      })
    ],
    server: {
      host: true,
      port: 5174,
      allowedHosts: true,
      strictPort: false,
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true, secure: true }
      }
    },
    preview: { host: true }
  };
});
