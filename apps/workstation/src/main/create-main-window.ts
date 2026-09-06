import { BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { writeSmokeLog } from './smoke-log.js';

interface RendererSmokeState {
  readonly require: string;
  readonly process: string;
  readonly ipc: string;
  readonly bridge: readonly string[];
  readonly snapshot: {
    readonly core: string;
    readonly agent: string;
  };
  readonly ui: {
    readonly shell: boolean;
    readonly trackCount: number;
    readonly agentTitle: string | null;
  };
}

interface SpessaSynthSmokeState {
  readonly require: string;
  readonly process: string;
  readonly ipc: string;
  readonly bridge: readonly string[];
  readonly report: {
    readonly schemaVersion: number;
    readonly status: string;
    readonly phase: string;
    readonly checks: readonly unknown[];
  };
}

interface MainWindowOptions {
  readonly onRendererReady?: (state: RendererSmokeState) => void;
  readonly onSpessaSynthReady?: (state: SpessaSynthSmokeState) => void;
}

export const secureWebPreferences = (): Electron.WebPreferences => ({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  preload: join(__dirname, '../preload/index.cjs'),
});
const spessaSynthQuery = (): Record<string, string> | undefined =>
  process.env.AGENT_MUSIC_SPESSA_SPIKE === '1'
    ? { 'spessa-spike': '1' }
    : undefined;

export const loadRenderer = (window: BrowserWindow): Promise<void> => {
  const query = spessaSynthQuery();
  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    if (query !== undefined) {
      for (const [key, value] of Object.entries(query)) {
        rendererUrl.searchParams.set(key, value);
      }
    }
    return window.loadURL(rendererUrl.toString());
  }
  return window.loadFile(join(__dirname, '../renderer/index.html'), {
    ...(query === undefined ? {} : { query }),
  });
};
export const createMainWindow = (
  options: MainWindowOptions = {},
): BrowserWindow => {
  const window = new BrowserWindow({
    show: false,
    width: 1512,
    height: 982,
    minWidth: 1080,
    minHeight: 720,
    useContentSize: true,
    backgroundColor: '#080b0f',
    webPreferences: secureWebPreferences(),
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.once('ready-to-show', () => {
    window.show();
  });
  if (process.env.AGENT_MUSIC_SMOKE === '1') {
    window.webContents.once('did-finish-load', () => {
      writeSmokeLog('SMOKE:renderer-loaded');
      if (process.env.AGENT_MUSIC_SPESSA_SPIKE === '1') {
        void window.webContents
          .executeJavaScript(
            `(async () => {
              const deadline = Date.now() + 5000;
              while (globalThis.__spessaSynthSpikeReport === undefined && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              const reportPromise = globalThis.__spessaSynthSpikeReport;
              if (reportPromise === undefined) {
                throw new Error('SpessaSynth report promise was not registered.');
              }
              const report = await Promise.race([
                reportPromise,
                new Promise((resolve) => setTimeout(() => resolve({
                  schemaVersion: 1,
                  mode: 'generated',
                  status: 'failed',
                  phase: 'boot',
                  checks: [],
                  error: 'SpessaSynth renderer probe timed out.'
                }), 20000))
              ]);
              return {
                require: typeof globalThis.require,
                process: typeof globalThis.process,
                ipc: typeof globalThis.ipcRenderer,
                bridge: Object.keys(globalThis.agentMusic ?? {}).sort(),
                report
              };
            })()`,
          )
          .then((value: unknown) => {
            if (
              typeof value === 'object' &&
              value !== null &&
              typeof (value as Partial<SpessaSynthSmokeState>).require ===
                'string' &&
              typeof (value as Partial<SpessaSynthSmokeState>).process ===
                'string' &&
              typeof (value as Partial<SpessaSynthSmokeState>).ipc ===
                'string' &&
              Array.isArray((value as Partial<SpessaSynthSmokeState>).bridge) &&
              typeof (value as Partial<SpessaSynthSmokeState>).report ===
                'object'
            ) {
              options.onSpessaSynthReady?.(value as SpessaSynthSmokeState);
            } else {
              writeSmokeLog(
                `SMOKE:spessasynth-state-invalid:${JSON.stringify(value)}`,
              );
            }
          })
          .catch((error: unknown) => {
            writeSmokeLog(`SMOKE:spessasynth-state-error:${String(error)}`);
          });
        return;
      }
      void window.webContents
        .executeJavaScript(
          `(async () => {
            const bridge = globalThis.agentMusic;
            await new Promise((resolve) => {
              const deadline = Date.now() + 5000;
              const poll = () => {
                if (document.querySelector('.workstation-shell') !== null || Date.now() >= deadline) {
                  resolve(undefined);
                  return;
                }
                setTimeout(poll, 25);
              };
              poll();
            });
            return {
              require: typeof globalThis.require,
              process: typeof globalThis.process,
              ipc: typeof globalThis.ipcRenderer,
              bridge: Object.keys(bridge ?? {}).sort(),
              snapshot: await bridge?.getServiceSnapshot?.(),
              ui: {
                shell: document.querySelector('.workstation-shell') !== null,
                trackCount: document.querySelectorAll('.track-row[data-track-id]').length,
                agentTitle: document.querySelector('.agent-panel__header h2')?.textContent ?? null
              }
            };
          })()`,
        )
        .then((value: unknown) => {
          if (
            typeof value === 'object' &&
            value !== null &&
            typeof (value as Partial<RendererSmokeState>).require ===
              'string' &&
            typeof (value as Partial<RendererSmokeState>).process ===
              'string' &&
            typeof (value as Partial<RendererSmokeState>).ipc === 'string' &&
            Array.isArray((value as Partial<RendererSmokeState>).bridge) &&
            typeof (value as Partial<RendererSmokeState>).snapshot ===
              'object' &&
            typeof (value as Partial<RendererSmokeState>).ui === 'object'
          ) {
            options.onRendererReady?.(value as RendererSmokeState);
          } else {
            writeSmokeLog(
              `SMOKE:renderer-state-invalid:${JSON.stringify(value)}`,
            );
          }
        })
        .catch((error: unknown) => {
          writeSmokeLog(`SMOKE:renderer-state-error:${String(error)}`);
        });
    });
  }
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );
  void loadRenderer(window);
  return window;
};
