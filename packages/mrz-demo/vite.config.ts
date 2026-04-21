import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    host: ['localhost', '10.33.33.3'],
  },
  build: {
    outDir: 'dist',
  },
  worker: {
    format: 'es',
  },
});
