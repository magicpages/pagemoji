import { defineConfig } from 'vitest/config';

// The script-tag build: one self-contained IIFE that defines the element and
// mounts it from its own data attributes. The npm entry points are emitted by tsc.
export default defineConfig({
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/auto.ts',
      name: 'Pagemoji',
      formats: ['iife'],
      fileName: () => 'pagemoji.js',
    },
    emptyOutDir: false,
  },
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://www.example.com/blog/post/?utm_source=x#top' } },
  },
});
