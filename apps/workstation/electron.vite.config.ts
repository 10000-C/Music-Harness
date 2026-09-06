import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input:
          process.env.AGENT_MUSIC_INCLUDE_FAKE_SERVICES === '1'
            ? {
                index: 'src/main/index.ts',
                'fake-service-entry': 'src/test-support/fake-service-entry.ts',
              }
            : 'src/main/index.ts',
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: 'src/preload/index.ts',
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    esbuild: {
      jsx: 'automatic',
    },
  },
});
