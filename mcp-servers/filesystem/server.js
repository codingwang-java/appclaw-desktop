const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const os = require('os');

const capabilities = { tools: true };

const TOOLS = [
  {
    name: 'fs_list_dir',
    description: '列出指定目录下的所有文件和子目录',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '目录路径，留空表示当前目录' } },
      required: []
    }
  },
  {
    name: 'fs_read_file',
    description: '读取一个文本文件的内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: '要读取的文件路径' } },
      required: ['path']
    }
  },
  {
    name: 'fs_write_file',
    description: '将内容写入文件，会覆盖已有文件',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要写入的文件路径' },
        content: { type: 'string', description: '文件内容' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'shell_exec',
    description: '在终端中执行一条命令并获取输出（适合短时命令，不适合长时间运行的 GUI 程序）',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令字符串' },
        cwd: { type: 'string', description: '命令执行的工作目录（可选）' }
      },
      required: ['command']
    }
  },
  {
    name: 'app_launch',
    description: '启动一个桌面应用程序（GUI 程序），如 Steam、浏览器、Office 等。工具会自动在 Windows 上使用 start 命令，使程序脱离父进程独立运行，不会阻塞等待程序退出。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要启动的程序路径（例如 d:/steam/steam.exe）' },
        args: { type: 'string', description: '命令行参数（可选，例如 steam://run/570）' }
      },
      required: ['path']
    }
  }
];

function send(method, params, id) {
  const msg = { jsonrpc: '2.0', method, params };
  if (id !== undefined) msg.id = id;
  process.stdout.write(JSON.stringify(msg) + os.EOL);
}

function readStdinAsync() {
  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(os.EOL);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          handleRequest(obj);
        } catch (e) {
          console.error('parse error:', line.slice(0, 100));
        }
      }
    });
    process.stdin.on('end', () => resolve(null));
  });
}

function handleRequest(obj) {
  if (obj.method === 'initialize') {
    send('undefined', { protocolVersion: '2024-11-05', capabilities, serverInfo: { name: 'appclaw-filesystem', version: '0.1.0' } }, obj.id);
    return;
  }
  if (obj.method === 'notifications/initialized') return;
  if (obj.method === 'tools/list') {
    send('tools/list', { tools: TOOLS }, obj.id);
    return;
  }
  if (obj.method === 'tools/call') {
    const { name, arguments: args } = obj.params || {};
    const requestId = obj.id;
    handleToolCall(name, args || {}, requestId);
    return;
  }
}

function handleToolCall(name, args, requestId) {
  try {
    if (name === 'fs_list_dir') {
      const p = args.path || process.cwd();
      const entries = fs.readdirSync(p, { withFileTypes: true });
      const lines = entries.slice(0, 200).map((e) => `${e.isDirectory() ? '[DIR]  ' : '[FILE] '} ${e.name}`);
      sendSuccess(requestId, lines.join('\n') || '（空目录）');
      return;
    }
    if (name === 'fs_read_file') {
      const content = fs.readFileSync(args.path, 'utf-8');
      sendSuccess(requestId, content.slice(0, 8000));
      return;
    }
    if (name === 'fs_write_file') {
      const dir = path.dirname(args.path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(args.path, args.content || '', 'utf-8');
      sendSuccess(requestId, `已写入: ${args.path}`);
      return;
    }
    if (name === 'shell_exec') {
      exec(args.command, { cwd: args.cwd, timeout: 30000, maxBuffer: 2000000 }, (err, stdout, stderr) => {
        const text = err
          ? stderr || err.message || '命令执行失败'
          : (stdout + stderr).slice(0, 8000) || '（命令执行成功，无输出）';
        sendToolResult(requestId, text, !!err);
      });
      return;
    }
    if (name === 'app_launch') {
      if (!args.path) {
        sendToolResult(requestId, '错误: 必须提供 path 参数', true);
        return;
      }
      const normalizedPath = args.path.replace(/\//g, '\\');
      if (!fs.existsSync(args.path) && !fs.existsSync(normalizedPath)) {
        sendToolResult(requestId, '错误: 找不到程序路径: ' + args.path, true);
        return;
      }

      const cmdArgs = args.args ? `"${args.args}"` : '';

      if (process.platform === 'win32') {
        const cmd = `start "" "${normalizedPath}" ${cmdArgs}`;
        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) {
            sendToolResult(requestId, '启动失败: ' + (err.message || stderr || '未知错误'), true);
          } else {
            sendToolResult(requestId, `已成功启动程序: ${args.path}${cmdArgs ? ' ' + cmdArgs : ''}`);
          }
        });
      } else {
        const child = spawn(args.path, args.args ? [args.args] : [], { detached: true, stdio: 'ignore' });
        child.unref();
        sendToolResult(requestId, `已成功启动程序: ${args.path}`);
      }
      return;
    }

    sendToolResult(requestId, `未知工具: ${name}`, true);
  } catch (err) {
    sendToolResult(requestId, err.message || String(err), true);
  }
}

function sendSuccess(requestId, text) {
  send('tools/call', { content: [{ type: 'text', text }], isError: false }, requestId);
}

function sendToolResult(requestId, text, isError) {
  send('tools/call', { content: [{ type: 'text', text }], isError: !!isError }, requestId);
}

process.stdout.write('');
readStdinAsync();
