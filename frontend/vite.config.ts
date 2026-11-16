import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4174,
    strictPort: true,
    proxy: {
      '/rosbridge': {
        target: 'ws://127.0.0.1:9090',
        ws: true,
        rewrite: () => '/',
      },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1400,
  },
});
