// Entry point for the controller process. The games themselves run in the user's installed
// Chrome/Edge; this process only arranges windows and hosts a tiny toolbar.
import { app } from 'electron';
import { Controller } from './controller';
import { Logger } from './logger';
import { appPaths } from './paths';

app.setName('MultiGame Viewer');
app.setAppUserModelId('MultiGameViewer');
// The viewer's own UI is a small toolbar; keep the GPU entirely for the four video streams.
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const log = new Logger(appPaths().logFile, process.env.MGV_DEBUG ? 'debug' : 'info');
  let controller: Controller | null = null;
  let quitting = false;

  process.on('uncaughtException', (err) => log.error('Uncaught exception', err));
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection', err));

  app.on('second-instance', () => controller?.onSecondInstance());
  app.on('window-all-closed', () => {
    /* keep running: the viewer lives in the tray while games are open */
  });
  app.on('before-quit', (e) => {
    if (quitting || !controller) return;
    e.preventDefault();
    quitting = true;
    void controller.shutdown().finally(() => {
      log.close();
      app.quit();
    });
  });

  app
    .whenReady()
    .then(async () => {
      log.info(`MultiGame Viewer ${app.getVersion()} starting (Electron ${process.versions.electron})`);
      controller = new Controller(log);
      await controller.start();
    })
    .catch((err) => {
      log.error('Startup failed', err);
      app.exit(1);
    });
}
