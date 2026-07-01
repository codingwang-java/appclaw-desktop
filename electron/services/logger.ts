import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.join(require('os').homedir(), '.appclaw');
const LOG_DIR = path.join(APP_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

let _initialized = false;

function ensureLogDir() {
  if (_initialized) return;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    _initialized = true;
  } catch {
    // Ignore - can't log in this case anyway
  }
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const rotated = path.join(LOG_DIR, `app.${Date.now()}.log`);
      fs.renameSync(LOG_FILE, rotated);
      // Keep only last 3 rotated files
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('app.') && f.endsWith('.log'))
        .sort()
        .reverse();
      if (files.length > 3) {
        files.slice(3).forEach(f => {
          try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch {}
        });
      }
    }
  } catch {}
}

function write(level: string, tag: string, msg: string, data?: any) {
  ensureLogDir();
  const ts = new Date().toISOString();
  const extra = data !== undefined ? ' ' + JSON.stringify(data, null, 0) : '';
  const line = `[${ts}] [${level}] [${tag}] ${msg}${extra}\n`;
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {}
  // Also output to console for dev mode
  if (level === 'ERROR') {
    console.error(line.trim());
  } else if (level === 'WARN') {
    console.warn(line.trim());
  } else {
    console.log(line.trim());
  }
}

export const logger = {
  info: (tag: string, msg: string, data?: any) => write('INFO', tag, msg, data),
  warn: (tag: string, msg: string, data?: any) => write('WARN', tag, msg, data),
  error: (tag: string, msg: string, data?: any) => write('ERROR', tag, msg, data),
  debug: (tag: string, msg: string, data?: any) => write('DEBUG', tag, msg, data),
};