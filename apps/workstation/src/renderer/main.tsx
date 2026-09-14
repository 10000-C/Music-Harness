import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import { App } from './app.js';
import './styles.css';
import type { SpessaSynthSpikeReport } from './spessasynth-spike/spike-report.js';

declare global {
  var __spessaSynthSpikeReport: Promise<SpessaSynthSpikeReport> | undefined;
}

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('Renderer root element is missing.');

if (new URLSearchParams(window.location.search).has('spessa-spike')) {
  globalThis.__spessaSynthSpikeReport =
    import('./spessasynth-spike/spike-app.js')
      .then(({ mountSpessaSynthSpike }) => mountSpessaSynthSpike(rootElement))
      .catch((error: unknown): SpessaSynthSpikeReport => ({
        schemaVersion: 1,
        mode: 'generated',
        status: 'failed',
        phase: 'boot',
        checks: [],
        error: error instanceof Error ? error.message : String(error),
      }));
} else {
  createRoot(rootElement).render(createElement(App));
}
