import { ipcMain, BrowserWindow } from 'electron';
import {
  listSessions,
  createSession,
  deleteSession,
  listMessages,
  searchMemory,
  addMemory,
  loadL1Memory,
  saveL1Memory,
  searchL2,
  addL3Memory,
  searchL3
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
import { listSkills, executeSkill, deleteSkill, createSkill, saveSkill, getSkillSystemPrompt, skillExists } from './services/skill-manager';
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
  ipcMain.handle('memory:l1:get', async () => loadL1Memory());
  ipcMain.handle('memory:l1:save', async (_e, data: { memory: string; user: string }) => saveL1Memory(data));
  ipcMain.handle('memory:l2:search', async (_e, { query, limit }: { query: string; limit?: number }) => searchL2(query, limit || 3));
  ipcMain.handle('memory:l3:add', async (_e, { content, memoryType, sourceSession }: { content: string; memoryType?: string; sourceSession?: string }) => addL3Memory(content, memoryType || 'fact', sourceSession));
  ipcMain.handle('memory:l3:search', async (_e, { query, limit }: { query: string; limit?: number }) => searchL3(query, limit || 5));

  ipcMain.handle('tool:list', async () => listServers());

  // 自动更新
  ipcMain.handle('update:check', async () => checkForUpdates());
  ipcMain.handle('update:download', async () => { await downloadUpdate(); });
  ipcMain.handle('update:install', async () => quitAndInstall());

  // Skill 管理
  ipcMain.handle('skill:list', async () => listSkills());
  ipcMain.handle('skill:execute', async (_e, skillId: string, params: Record<string, string>) => executeSkill(skillId, params));
  ipcMain.handle('skill:delete', async (_e, skillId: string) => deleteSkill(skillId));
  ipcMain.handle('skill:create', async (_e, skill: any) => createSkill(skill));
  ipcMain.handle('skill:save', async (_e, skillId: string, updates: any) => saveSkill(skillId, updates));
  ipcMain.handle('skill:getPrompt', async (_e, skillId: string) => getSkillSystemPrompt(skillId));
  ipcMain.handle('skill:exists', async (_e, skillId: string) => skillExists(skillId));

  // LLM 测试连接
  ipcMain.handle('llm:test', async (_e, cfg: LLMConfig) => {
    try {
      const { OpenAI } = await import('openai');
      const baseURL = cfg.baseUrl || undefined;
      console.log('[LLM Test] baseURL:', baseURL, 'model:', cfg.model);
      const client = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL,
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
      const msg = err.message || String(err);
      const status = err.status || err.statusCode;
      const detail = err.error?.message || err.error?.error?.message || '';
      console.error('[LLM Test] 失败:', status, msg, detail);
      let errorHint = msg;
      if (status === 401 || msg.includes('Incorrect API key') || msg.includes('Invalid API Key')) {
        errorHint = 'API Key 无效，请检查是否正确';
      } else if (status === 404 || msg.includes('model_not_found') || msg.includes('does not exist')) {
        errorHint = `模型 ${cfg.model} 不存在，请检查模型名称或 Base URL 是否正确`;
      } else if (status === 400 && detail) {
        errorHint = detail;
      } else if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
        errorHint = '无法连接服务器，请检查 Base URL';
      } else if (msg.includes('fetch failed') || msg.includes('NetworkError')) {
        errorHint = '网络错误，请检查 Base URL 是否正确';
      }
      return { success: false, error: errorHint };
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
