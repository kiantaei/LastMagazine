import { defineConfig } from 'vite';

export default defineConfig({
  // pinned + strict so `npm run dev` always answers on the same URL the
  // desktop launcher polls (http://localhost:5173)
  server: { port: 5173, strictPort: true, host: 'localhost' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
