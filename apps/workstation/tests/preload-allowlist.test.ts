import { expect, it, vi } from 'vitest';

it('exposes only the DesktopBridge allowlist and no raw Electron objects', async () => {
  const exposed: Record<string, unknown> = {};
  const on = vi.fn();
  const removeListener = vi.fn();
  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld: (name: string, value: unknown) => {
        exposed[name] = value;
      },
    },
    ipcRenderer: { invoke: vi.fn(), on, removeListener },
  }));
  await import('../src/preload/index.js');
  expect(Object.keys(exposed.agentMusic as object).sort()).toEqual([
    'chooseExportPath',
    'chooseProjectDirectory',
    'dispatchProject',
    'getServiceSnapshot',
    'onServiceSnapshot',
    'restartService',
  ]);
  expect(exposed).not.toHaveProperty('ipcRenderer');
  expect(exposed).not.toHaveProperty('require');
});
