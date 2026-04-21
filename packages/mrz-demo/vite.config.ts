import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: '/mrz-scanner/',
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
