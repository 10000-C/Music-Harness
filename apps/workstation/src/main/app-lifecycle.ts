import { BrowserWindow, type App } from 'electron';
import type { ServiceSupervisor } from './service-supervisor/index.js';

export const installAppLifecycle = (
  app: App,
  supervisor: ServiceSupervisor,
  createWindow: () => BrowserWindow,
): void => {
  let stopping: Promise<void> | undefined;
  const shutdown = (): Promise<void> =>
    (stopping ??= supervisor.shutdown('appQuit'));
  void app
    .whenReady()
    .then(async () => {
      await supervisor.start();
      createWindow();
    })
    .catch(() => {
      app.quit();
    });
  app.on('before-quit', (event) => {
    if (!stopping) {
      event.preventDefault();
      void shutdown().finally(() => {
        app.quit();
      });
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      void shutdown().finally(() => {
        app.quit();
      });
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
};
