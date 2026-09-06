import { defineConfig } from 'vite';

/** Browser-only Renderer harness used for visual and interaction QA. */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
});
