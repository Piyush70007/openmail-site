import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('./frontend', import.meta.url));
const python = { target: 'http://127.0.0.1:3000', changeOrigin: false };
const mailboxPaths = ['/api', '/app.html', '/app.css', '/styles.css', '/workspace.css', '/insights.css', '/workspace-navigation.css',
  '/app-ui.js', '/app-ai-documents.js', '/vendor', '/favicon.svg'];

export default defineConfig({
  root,
  base: '/',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./landing-dist', import.meta.url)),
    emptyOutDir: true,
    assetsDir: 'landing-assets',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(mailboxPaths.map((path) => [path, python])),
  },
});
