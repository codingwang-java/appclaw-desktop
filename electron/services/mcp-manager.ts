import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import os from 'os';
import type { MCPServerConfig, ToolResult } from '../../src/shared/types';

interface ServerInstance {
  config: MCPServerConfig;
  process: ChildProcess;
  tools: string[];
  pendingPromises: Map<string, { resolve: (r: any) => void; reject: (e: any) => void }>;
  requestId: number;
  buffer: string;
  initialized: boolean;
}

const servers = new Map<string, ServerInstance>();

function findSystemNode(): string | null {
  // 开发模式：直接用 process.execPath
  if (!process.execPath.includes('AppClaw.exe') && !process.execPath.includes('Electron')) {
    return process.execPath;
  }
  // 打包模式：尝试常见 Node.js 路径
  const candidates = [
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'nvm4w', 'nodejs', 'node.exe'),
    path.join(os.homedir(), '.nvm', 'versions', 'node', 'current', 'bin', 'node'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

const fs = require('fs');

const BUILTIN_TOOLS: Record<string, any[]> = {
  memory: [
    {
      type: 'function',
      function: {
        name: 'memory_search',
        description: '在长期记忆中搜索相关信息',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'memory_add',
        description: '向长期记忆中添加一条重要信息',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '记忆内容' },
            memory_type: { type: 'string', description: '类型: fact/preference/instruction' }
          },
          required: ['content']
        }
      }
    }
  ],
  filesystem: [
    {
      type: 'function',
      function: {
        name: 'fs_list_dir',
        description: '列出目录下的文件和文件夹',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '目录路径，默认当前工作目录' } }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fs_read_file',
        description: '读取一个文件的内容',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' } },
          required: ['path']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'fs_write_file',
        description: '写入文件内容（会覆盖已有文件）',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' }
          },
          required: ['path', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'shell_exec',
        description: '在终端执行一条命令',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令' },
            cwd: { type: 'string', description: '工作目录（可选）' }
          },
          required: ['command']
        }
      }
    }
  ],
  browser: [
    {
      type: 'function',
      function: {
        name: 'browser_navigate',
        description: '在浏览器中打开指定 URL',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: '要访问的网址' } },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browser_search',
        description: '使用默认搜索引擎搜索关键词',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索词' } },
          required: ['query']
        }
      }
    }
  ],
  desktop: [
    {
      type: 'function',
      function: {
        name: 'desktop_screenshot',
        description: '截取当前屏幕截图并保存为文件。返回截图文件路径，可配合视觉模型分析屏幕内容。',
        parameters: {
          type: 'object',
          properties: {
            outputPath: { type: 'string', description: '截图保存路径（可选，默认保存到临时目录）' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_click',
        description: '在指定坐标处点击鼠标左键',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标（像素）' },
            y: { type: 'number', description: 'Y 坐标（像素）' },
            button: { type: 'string', description: '鼠标按键: left/right/middle，默认 left' }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_double_click',
        description: '在指定坐标处双击鼠标左键',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标（像素）' },
            y: { type: 'number', description: 'Y 坐标（像素）' }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_type',
        description: '模拟键盘输入文字（需要目标窗口已激活）',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要输入的文字' }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_move',
        description: '将鼠标移动到指定坐标',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X 坐标（像素）' },
            y: { type: 'number', description: 'Y 坐标（像素）' }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_scroll',
        description: '在当前位置滚动鼠标滚轮',
        parameters: {
          type: 'object',
          properties: {
            amount: { type: 'number', description: '滚动量，正数向上，负数向下，默认 120' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_screen_size',
        description: '获取当前屏幕分辨率',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'desktop_press_key',
        description: '按下键盘按键（如 Enter、Tab、Escape、Ctrl+C 等）',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '按键名称，如 Enter、Tab、Escape、F5、{ENTER}、^{c}（Ctrl+C）等' }
          },
          required: ['key']
        }
      }
    }
  ]
};

export function getToolDefinitions(enabledTools: string[]): any[] {
  const result: any[] = [];
  for (const tool of enabledTools) {
    if (BUILTIN_TOOLS[tool]) {
      result.push(...BUILTIN_TOOLS[tool]);
    }
  }
  for (const [id, server] of servers) {
    if (server.tools.length > 0) {
      result.push(...server.tools.map((t) => ({ type: 'function', function: { name: `${id}.${t}` } })));
    }
  }
  return result;
}

export async function startMCPServer(config: MCPServerConfig, projectRoot: string): Promise<void> {
  if (servers.has(config.id)) return;
  if (!config.enabled) return;

  // 内置工具（filesystem/browser）已在主进程中直接处理，无需启动子进程
  // 只有第三方 MCP server 才需要子进程启动
  if (config.id === 'filesystem' || config.id === 'browser') {
    console.log(`[MCP] 内置工具 ${config.id} 已在主进程中就绪，跳过子进程启动`);
    return;
  }

  let command = config.command;
  let args = [...config.args];

  // 打包后修复：使用系统 Node.js
  if (command === 'node') {
    // 尝试找到系统 node
    const systemNode = findSystemNode();
    if (systemNode) {
      command = systemNode;
    } else {
      console.warn(`[MCP] 找不到系统 Node.js，跳过启动 ${config.id}`);
      return;
    }
  }

  if (config.command === 'node' && args[0] && args[0].endsWith('.js')) {
    let scriptPath = path.isAbsolute(args[0]) ? args[0] : path.join(projectRoot, args[0]);

    // 打包后脚本在 asar.unpack 目录中
    if (scriptPath.includes('app.asar')) {
      scriptPath = scriptPath.replace('app.asar', 'app.asar.unpacked');
    }

    args = [scriptPath, ...args.slice(1)];
  }

  const cwd = config.cwd || projectRoot;

  const child = spawn(command, args, {
    cwd: cwd as string,
    env: { ...process.env, ...config.env } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'] as any
  });

  const instance: ServerInstance = {
    config,
    process: child,
    tools: [],
    pendingPromises: new Map(),
    requestId: 0,
    buffer: '',
    initialized: false
  };

  child.stdout?.on('data', (data) => {
    instance.buffer += data.toString();
    const lines = instance.buffer.split(os.EOL);
    instance.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        handleServerResponse(instance, obj);
      } catch {
        console.debug('[MCP stdout]', line.slice(0, 200));
      }
    }
  });

  child.stderr?.on('data', (data) => {
    console.debug(`[MCP stderr:${config.id}]`, data.toString().slice(0, 300));
  });

  child.on('exit', (code) => {
    console.log(`[MCP server:${config.id}] exited with code ${code}`);
    servers.delete(config.id);
  });

  servers.set(config.id, instance);

  instance.requestId++;
  const initMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: instance.requestId,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'AppClaw', version: '0.1.0' } }
  });
  child.stdin?.write(initMsg + os.EOL);

  instance.requestId++;
  const notifMsg = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  child.stdin?.write(notifMsg + os.EOL);

  instance.initialized = true;
}

function handleServerResponse(instance: ServerInstance, obj: any) {
  if (obj.id && instance.pendingPromises.has(String(obj.id))) {
    const { resolve, reject } = instance.pendingPromises.get(String(obj.id))!;
    instance.pendingPromises.delete(String(obj.id));
    if (obj.error) reject(obj.error);
    else resolve(obj.result);
    return;
  }
  if (obj.method === 'textDocument/publishDiagnostics' || obj.method?.startsWith('notifications')) {
    return;
  }
}

export async function callTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
  const startTime = Date.now();

  if (toolName.startsWith('memory_')) {
    return handleMemoryTool(toolName, args);
  }
  if (toolName === 'fs_list_dir' || toolName === 'fs_read_file' || toolName === 'fs_write_file' || toolName === 'shell_exec') {
    return handleFilesystemTool(toolName, args);
  }
  if (toolName === 'browser_navigate' || toolName === 'browser_search') {
    return handleBrowserTool(toolName, args);
  }
  if (toolName.startsWith('desktop_')) {
    return handleDesktopTool(toolName, args);
  }

  const dotIdx = toolName.indexOf('.');
  if (dotIdx > 0) {
    const serverId = toolName.substring(0, dotIdx);
    const funcName = toolName.substring(dotIdx + 1);
    const instance = servers.get(serverId);
    if (instance) {
      return callMCPTool(instance, funcName, args);
    }
  }

  return { success: false, content: `未找到工具: ${toolName}`, error: 'tool-not-found' };
}

async function callMCPTool(instance: ServerInstance, funcName: string, args: Record<string, any>): Promise<ToolResult> {
  return new Promise((resolve) => {
    instance.requestId++;
    const id = String(instance.requestId);
    instance.pendingPromises.set(id, {
      resolve: (result) => {
        resolve({ success: true, content: formatToolResult(result) });
      },
      reject: (err) => {
        resolve({ success: false, content: JSON.stringify(err), error: err?.message || 'tool-error' });
      }
    });

    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: funcName, arguments: args }
    });

    instance.process.stdin?.write(msg + os.EOL);

    setTimeout(() => {
      if (instance.pendingPromises.has(id)) {
        instance.pendingPromises.delete(id);
        resolve({ success: false, content: '工具调用超时', error: 'timeout' });
      }
    }, 30000);
  });
}

function formatToolResult(result: any): string {
  if (typeof result === 'string') return result;
  if (result?.content) {
    if (Array.isArray(result.content)) {
      return result.content
        .map((c: any) => c.text || (typeof c === 'string' ? c : JSON.stringify(c)))
        .join('\n');
    }
    if (typeof result.content === 'string') return result.content;
  }
  return JSON.stringify(result, null, 2);
}

async function handleMemoryTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
  const { searchMemory, addMemory } = await import('./memory-service');

  if (toolName === 'memory_search') {
    const items = await searchMemory(args.query || '', 5);
    return {
      success: true,
      content: items.length === 0 ? '没有找到相关记忆' : items.map((m: any) => `- ${m.content}`).join('\n')
    };
  }
  if (toolName === 'memory_add') {
    const id = await addMemory(args.content || '', args.memory_type || 'fact');
    return { success: true, content: `已保存记忆 (${id.substring(0, 8)}...)` };
  }
  return { success: false, content: '未知 memory 工具', error: 'unknown-tool' };
}

async function handleFilesystemTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
  return new Promise((resolve) => {
    import('fs')
      .then((fs) => {
        const { exec } = require('child_process');

        if (toolName === 'fs_list_dir') {
          try {
            const p = args.path || process.cwd();
            const entries = fs.readdirSync(p, { withFileTypes: true });
            const lines = entries.map((e: any) => `${e.isDirectory() ? '[DIR]  ' : '[FILE] '} ${e.name}`);
            resolve({ success: true, content: lines.join('\n') || '（空目录）' });
          } catch (err: any) {
            resolve({ success: false, content: err.message, error: err.code });
          }
          return;
        }
        if (toolName === 'fs_read_file') {
          try {
            const content = fs.readFileSync(args.path, 'utf-8');
            resolve({ success: true, content: content.slice(0, 8000) });
          } catch (err: any) {
            resolve({ success: false, content: err.message, error: err.code });
          }
          return;
        }
        if (toolName === 'fs_write_file') {
          try {
            const dir = path.dirname(args.path);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(args.path, args.content || '', 'utf-8');
            resolve({ success: true, content: `已写入: ${args.path}` });
          } catch (err: any) {
            resolve({ success: false, content: err.message, error: err.code });
          }
          return;
        }
        if (toolName === 'shell_exec') {
          exec(args.command, { cwd: args.cwd, timeout: 30000, maxBuffer: 2000000 }, (err: any, stdout: string, stderr: string) => {
            if (err) {
              resolve({ success: false, content: stderr || err.message, error: err.code });
            } else {
              resolve({ success: true, content: (stdout + stderr).slice(0, 8000) || '（命令执行成功，无输出）' });
            }
          });
          return;
        }
        resolve({ success: false, content: `未知文件系统工具: ${toolName}`, error: 'unknown-tool' });
      })
      .catch((err) => {
        resolve({ success: false, content: err.message, error: err.code });
      });
  });
}

async function handleBrowserTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
  return new Promise((resolve) => {
    import('child_process')
      .then(({ exec }) => {
        let url = args.url;
        if (toolName === 'browser_search') {
          url = `https://www.google.com/search?q=${encodeURIComponent(args.query || '')}`;
        }
        if (!url) {
          resolve({ success: false, content: '缺少 URL 或 query 参数', error: 'missing-args' });
          return;
        }

        const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;

        exec(cmd, (err) => {
          if (err) resolve({ success: false, content: err.message || String(err), error: String(err.code || 'exec-error') });
          else resolve({ success: true, content: `已在浏览器打开: ${url}` });
        });
      })
      .catch((err) => {
        resolve({ success: false, content: err.message, error: 'unknown' });
      });
  });
}

async function handleDesktopTool(toolName: string, args: Record<string, any>): Promise<ToolResult> {
  if (process.platform !== 'win32') {
    return { success: false, content: '桌面操控工具目前仅支持 Windows', error: 'unsupported-platform' };
  }

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  async function runPS(script: string, timeout = 10000): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `appclaw-ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    try {
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
        { timeout }
      );
      return stdout.trim() || stderr.trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  if (toolName === 'desktop_screen_size') {
    try {
      const result = await runPS(`
Add-Type -AssemblyName System.Windows.Forms
$s = [System.Windows.Forms.Screen]::PrimaryScreen
Write-Output "$($s.Bounds.Width)x$($s.Bounds.Height)"
`);
      return { success: true, content: result };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'screen-size-error' };
    }
  }

  if (toolName === 'desktop_screenshot') {
    try {
      const outputPath = args.outputPath || path.join(os.tmpdir(), `appclaw-screenshot-${Date.now()}.png`);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const escapedPath = outputPath.replace(/\\/g, '\\\\');
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.X, $screen.Bounds.Y, 0, 0, $bitmap.Size)
$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output 'OK'
`, 15000);
      return { success: true, content: `截图已保存: ${outputPath}` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'screenshot-error' };
    }
  }

  if (toolName === 'desktop_move') {
    try {
      const x = Math.round(args.x);
      const y = Math.round(args.y);
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`);
      return { success: true, content: `鼠标已移动到 (${x}, ${y})` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'move-error' };
    }
  }

  if (toolName === 'desktop_click') {
    try {
      const x = Math.round(args.x);
      const y = Math.round(args.y);
      const button = args.button || 'left';
      const downFlag = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002';
      const upFlag = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004';
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Add-Type -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Win32Mouse -Namespace Win32
[Win32.Win32Mouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[Win32.Win32Mouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
`);
      const btnLabel = button === 'right' ? '右键' : button === 'middle' ? '中键' : '左键';
      return { success: true, content: `已${btnLabel}点击 (${x}, ${y})` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'click-error' };
    }
  }

  if (toolName === 'desktop_double_click') {
    try {
      const x = Math.round(args.x);
      const y = Math.round(args.y);
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Add-Type -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Win32Mouse -Namespace Win32
[Win32.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 100
[Win32.Win32Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
[Win32.Win32Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
`);
      return { success: true, content: `已双击 (${x}, ${y})` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'double-click-error' };
    }
  }

  if (toolName === 'desktop_type') {
    try {
      const text = (args.text || '').replace(/`/g, '``').replace(/"/g, '`"');
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${text}")
`, 10000);
      return { success: true, content: `已输入文字: ${args.text}` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'type-error' };
    }
  }

  if (toolName === 'desktop_scroll') {
    try {
      const amount = Math.round(args.amount || 120);
      await runPS(`
Add-Type -MemberDefinition '[DllImport("user32.dll")]public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);' -Name Win32Mouse -Namespace Win32
[Win32.Win32Mouse]::mouse_event(0x0800, 0, 0, ${amount}, 0)
`);
      return { success: true, content: `已滚动 ${amount > 0 ? '向上' : '向下'} ${Math.abs(amount)}` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'scroll-error' };
    }
  }

  if (toolName === 'desktop_press_key') {
    try {
      const key = (args.key || '').replace(/`/g, '``').replace(/"/g, '`"');
      await runPS(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${key}")
`, 5000);
      return { success: true, content: `已按下按键: ${args.key}` };
    } catch (err: any) {
      return { success: false, content: err.message, error: 'press-key-error' };
    }
  }

  return { success: false, content: `未知桌面工具: ${toolName}`, error: 'unknown-desktop-tool' };
}

export function listServers(): MCPServerConfig[] {
  const arr: MCPServerConfig[] = [];
  for (const [id, s] of servers) {
    arr.push({ id, name: s.config.name, command: s.config.command, args: s.config.args, enabled: s.initialized });
  }
  return arr;
}

export function shutdownAll() {
  for (const [, s] of servers) {
    try {
      s.process.kill();
    } catch {}
  }
  servers.clear();
}

export function needsConfirmation(toolName: string, agentPermissions: Record<string, any>): boolean {
  const highRisk = ['fs_write_file', 'shell_exec', 'email_send', 'browser_navigate', 'desktop_click', 'desktop_double_click', 'desktop_type', 'desktop_press_key'];
  if (highRisk.some((t) => toolName.includes(t))) return true;
  const perm = agentPermissions[toolName];
  if (perm && perm.requireConfirm) return true;
  return false;
}

export function getToolPreview(toolName: string, args: Record<string, any>): string {
  const pairs = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`);
  return `${toolName}\n  ${pairs.join('\n  ')}`;
}

export function getToolRisk(toolName: string): 'low' | 'medium' | 'high' {
  if (toolName.includes('write') || toolName.includes('shell_exec') || toolName.includes('send') || toolName.includes('exec')) return 'high';
  if (toolName.includes('read') || toolName.includes('list') || toolName.includes('search')) return 'medium';
  return 'low';
}
