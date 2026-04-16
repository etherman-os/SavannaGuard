import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/widget/',
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SavannaGuard',
      fileName: 'savanna-widget',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        assetFileNames: 'savanna-[name].[ext]',
      },
    },
    minify: 'terser',
    terserOptions: { compress: { passes: 2 } },
  },
  worker: {
    format: 'es',
  },
});