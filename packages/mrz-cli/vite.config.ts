import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/cli.ts',
      formats: ['es'],
      fileName: 'cli',
    },
    rollupOptions: {
      external: [
        '@mrz-scanner/scanner',
        'image-js',
        'node:fs/promises',
        'node:path',
        'node:process',
        'node:util',
      ],
    },
  },
});
