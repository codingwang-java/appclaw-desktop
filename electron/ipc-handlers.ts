import { ipcMain, BrowserWindow } from 'electron';
import {
  listSessions,
  createSession,
  deleteSession,
  listMessages,
  searchMemory,
  addMemory
} from './services/memory-service';
import {
  getWorkspace,
  listWorkspaces,
  saveWorkspace,
  getCurrentLLMConfig,
  saveLLMConfig
} from './services/workspace-manager';
import { sendChatMessage, resolveToolConfirmation, applyLLMConfig } from './services/agent-orchestrator';
import { listServers } from './services/mcp-manager';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './services/update-service';
import type { ChatSendPayload, LLMConfig, WorkspaceConfig } from '../src/shared/types';

export function registerIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window:minimize', async () => { BrowserWindow.getFocusedWindow()?.minimize(); });
  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.handle('window:close', async () => { BrowserWindow.getFocusedWindow()?.close(); });
  ipcMain.handle('window:isMaximized', async () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false);

  ipcMain.handle('workspace:list', async () => listWorkspaces());
  ipcMain.handle('workspace:get', async () => getWorkspace());
  ipcMain.handle('workspace:save', async (_e, cfg: WorkspaceConfig) => saveWorkspace(cfg));

  ipcMain.handle('llm:config:get', async () => getCurrentLLMConfig());
  ipcMain.handle('llm:config:save', async (_e, cfg: LLMConfig) => {
    applyLLMConfig(cfg);
    return saveLLMConfig(cfg);
  });

  ipcMain.handle('session:list', async () => listSessions());
  ipcMain.handle('session:create', async (_e, title: string) => createSession(title));
  ipcMain.handle('session:delete', async (_e, sessionId: string) => deleteSession(sessionId));

  ipcMain.handle('message:list', async (_e, sessionId: string) => listMessages(sessionId));

  ipcMain.handle('chat:send', async (_e, payload: ChatSendPayload) => {
    return sendChatMessage(payload.sessionId, payload.message, payload.agentId || 'default-agent');
  });

  ipcMain.handle('memory:search', async (_e, { query, limit }: { query: string; limit?: number }) => {
    return searchMemory(query, limit || 5);
  });
  ipcMain.handle('memory:add', async (_e, { content, memoryType }: { content: string; memoryType?: string }) => {
    const id = await addMemory(content, memoryType || 'fact');
    return !!id;
  });

  ipcMain.handle('tool:list', async () => listServers());

  // 自动更新
  ipcMain.handle('update:check', async () => checkForUpdates());
  ipcMain.handle('update:download', async () => { await downloadUpdate(); });
  ipcMain.handle('update:install', async () => quitAndInstall());

  // LLM 测试连接
  ipcMain.handle('llm:test', async (_e, cfg: LLMConfig) => {
    try {
      const { OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl || undefined,
      });
      const start = Date.now();
      const resp = await client.chat.completions.create({
        model: cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });
      const latency = Date.now() - start;
      return { success: true, latency, model: resp.model || cfg.model };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle(
    'tool:confirm:response',
    async (_e, { messageId, approved, modified }: { messageId: string; approved: boolean; modified?: string }) => {
      resolveToolConfirmation(messageId, approved, modified);
      return;
    }
  );

  ipcMain.on('app:log', (_e, msg) => {
    console.log('[app]', msg);
  });
}
