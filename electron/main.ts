import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers';
import { initializeWorkspace } from './services/workspace-manager';
import { initAutoUpdater } from './services/update-service';
import { logger } from './services/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.APP_DATA_DIR = path.join(homedir(), '.appclaw');

logger.info('APP', `AppClaw starting (version: ${process.env.npm_package_version || 'dev'})`);

// 捕获所有未处理异常，防止静默崩溃
process.on('uncaughtException', (err) => {
  logger.error('FATAL', 'Uncaught exception', { message: err.message, stack: err.stack?.split('\n').slice(0, 5).join('\n') });
  try { app.dialog?.showErrorBox?.('AppClaw 启动错误', String(err)); } catch {}
});

process.on('unhandledRejection', (reason) => {
  logger.error('FATAL', 'Unhandled rejection', { reason: String(reason) });
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    logger.info('APP', 'Initializing workspace...');
    await initializeWorkspace();
    logger.info('APP', 'Workspace initialized');
  } catch (err) {
    logger.error('APP', 'Workspace initialization failed', { error: String(err) });
    console.error('[WARN] Workspace initialization failed (app will still start):', err);
  }
  logger.info('APP', 'Registering IPC handlers...');
  registerIpcHandlers();
  logger.info('APP', 'Creating window...');
  createWindow();
  logger.info('APP', `Window created (${process.env.VITE_DEV_SERVER_URL ? 'dev' : 'production'})`);

  // 初始化自动更新（需要 mainWindow 已创建）
  if (mainWindow) {
    initAutoUpdater(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
