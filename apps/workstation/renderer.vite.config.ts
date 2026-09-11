import { defineConfig } from 'vite';

/** Browser-only Renderer harness used for visual and interaction QA. */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'spessasynth_core',
      'spessasynth_lib',
      'midi-file',
    ],
  },
});
