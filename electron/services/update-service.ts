import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let updateAvailable = false;
let downloadedInfo: UpdateInfo | null = null;

// 判断是否有可用的更新源（package.json 中 publish 不为空）
function hasUpdateSource(): boolean {
  try {
    const pkgPath = path.join(process.resourcesPath, 'app.asar', 'package.json');
    // 开发模式下从项目根目录读取
    const devPkgPath = path.join(process.cwd(), 'package.json');
    const pkgRaw = fs.readFileSync(fs.existsSync(pkgPath) ? pkgPath : devPkgPath, 'utf8');
    const pkg = JSON.parse(pkgRaw);
    const publish = pkg.build?.publish;
    if (!publish) return false;
    if (Array.isArray(publish) && publish.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow) {
  // 开发模式不检查更新
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[Updater] 开发模式，跳过自动更新');
    return;
  }

  // 没有配置更新源则不检查
  if (!hasUpdateSource()) {
    console.log('[Updater] 未配置更新源，跳过自动更新');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // 检查更新出错 - 静默处理网络错误
  autoUpdater.on('error', (err) => {
    const msg = err.message || '';
    // 网络错误、404 等静默处理，只记录日志
    if (msg.includes('404') || msg.includes('net::') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
      console.warn('[Updater] 网络错误（静默）:', msg.substring(0, 100));
      return;
    }
    console.error('[Updater] 错误:', msg);
    mainWindow.webContents.send('update:error', msg.substring(0, 200));
  });

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version);
    updateAvailable = true;
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
      console.error('[Updater] 检查失败:', err.message);
    });
  }, 3000);
}

export async function checkForUpdates(): Promise<{ available: boolean; version?: string; error?: string }> {
  if (!hasUpdateSource()) {
    return { available: false, error: '未配置更新源' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.updateInfo) {
      return { available: result.updateInfo.version !== autoUpdater.currentVersion.version, version: result.updateInfo.version };
    }
    return { available: false };
  } catch (err: any) {
    const msg = err.message || '';
    // 网络错误返回友好提示
    if (msg.includes('404') || msg.includes('net::') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
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
