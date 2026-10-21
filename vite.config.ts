import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({
  plugins: [vue(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'prompt',
    injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'] },
    manifest: {
      name: 'Local Editor', short_name: 'LocalEditor', description: 'Локальный редактор фото — без загрузки на сервер',
      lang: 'ru', start_url: '/', scope: '/', display: 'standalone', theme_color: '#1e1f26', background_color: '#1e1f26',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
      file_handlers: [{ action: '/', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'] } }],
      share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: 'image', accept: ['image/*'] }] } },
    } as any,
  })],
  preview: { allowedHosts: true, host: '0.0.0.0', port: 4173 },
  worker: { format: 'es' },
})
