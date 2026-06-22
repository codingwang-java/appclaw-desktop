const { exec } = require('child_process');
const os = require('os');

const TOOLS = [
  {
    name: 'browser_navigate',
    description: '使用系统默认浏览器打开指定网址',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: '要打开的 URL（包含 http:// 或 https://）' } },
      required: ['url']
    }
  },
  {
    name: 'browser_search',
    description: '使用默认搜索引擎搜索关键词',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query']
    }
  }
];

function send(method, params, id) {
  const msg = { jsonrpc: '2.0', method, params };
  if (id !== undefined) msg.id = id;
  process.stdout.write(JSON.stringify(msg) + os.EOL);
}

function openUrl(url) {
  return new Promise((resolve) => {
    let cmd;
    if (process.platform === 'win32') cmd = `start "" "${url}"`;
    else if (process.platform === 'darwin') cmd = `open "${url}"`;
    else cmd = `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) resolve({ text: err.message, error: true });
      else resolve({ text: `已在浏览器打开: ${url}` });
    });
  });
}

process.stdin.on('data', (chunk) => {
  const lines = chunk.toString().split(os.EOL);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.method === 'initialize') {
        send('undefined', { protocolVersion: '2024-11-05', capabilities: { tools: true }, serverInfo: { name: 'appclaw-browser', version: '0.1.0' } }, obj.id);
      } else if (obj.method === 'notifications/initialized') {
        // ignore
      } else if (obj.method === 'tools/list') {
        send('tools/list', { tools: TOOLS }, obj.id);
      } else if (obj.method === 'tools/call') {
        const { name, arguments: args } = obj.params || {};
        if (name === 'browser_navigate') {
          openUrl(args.url).then((r) => {
            send('tools/call', { content: [{ type: 'text', text: r.text }], isError: !!r.error }, obj.id);
          });
        } else if (name === 'browser_search') {
          const url = `https://www.google.com/search?q=${encodeURIComponent(args.query || '')}`;
          openUrl(url).then((r) => {
            send('tools/call', { content: [{ type: 'text', text: r.text }], isError: !!r.error }, obj.id);
          });
        } else {
          send('tools/call', { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true }, obj.id);
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
});
