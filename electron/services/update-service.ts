import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let downloadedInfo: UpdateInfo | null = null;

// 更新缓存目录
function getUpdateCacheDir(): string {
  return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'appclaw-updater');
}

// 清理旧的更新缓存
function cleanUpdateCache() {
  const cacheDir = getUpdateCacheDir();
  try {
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        try {
          fs.rmSync(filePath, { recursive: true, force: true });
        } catch { /* 忽略删除失败的文件 */ }
      }
      console.log('[Updater] 已清理更新缓存:', cacheDir);
    }
  } catch (e) {
    console.warn('[Updater] 清理缓存失败:', e);
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow) {
  // 开发模式不检查更新
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[Updater] 开发模式，跳过自动更新');
    return;
  }

  // 启动时清理上次更新留下的缓存
  cleanUpdateCache();

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 检查更新出错 - 静默处理网络错误
  autoUpdater.on('error', (err) => {
    const msg = err.message || '';
    if (msg.includes('404') || msg.includes('net::') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('No published versions')) {
      console.warn('[Updater] 网络错误（静默）:', msg.substring(0, 100));
      return;
    }
    console.error('[Updater] 错误:', msg);
    mainWindow.webContents.send('update:error', msg.substring(0, 200));
  });

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version);
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });
  });

  // 已是最新版本
  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] 已是最新版本:', info.version);
    mainWindow.webContents.send('update:not-available', { version: info.version });
  });

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  // 下载完成
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 更新已下载:', info.version);
    downloadedInfo = info;
    mainWindow.webContents.send('update:downloaded', {
      version: info.version,
    });
  });

  // 启动后延迟 3 秒检查更新
  setTimeout(() => {
    console.log('[Updater] 检查更新...');
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[Updater] 自动检查失败:', (err.message || '').substring(0, 100));
    });
  }, 3000);
}

export async function checkForUpdates(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      return { available: result.updateInfo.version !== autoUpdater.currentVersion.version, version: result.updateInfo.version };
    }
    return { available: false };
  } catch (err: any) {
    const msg = err.message || '';
    if (msg.includes('404') || msg.includes('net::') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('No published versions')) {
      return { available: false, error: '无法连接更新服务器' };
    }
    return { available: false, error: '检查更新失败' };
  }
}

export async function downloadUpdate(): Promise<void> {
  await autoUpdater.downloadUpdate();
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
