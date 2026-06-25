import { contextBridge, ipcRenderer } from 'electron';
import type {
  ChatSendPayload,
  Session,
  ChatMessage,
  MemoryItem,
  WorkspaceConfig,
  LLMConfig,
  ToolConfirmRequest,
  MCPServerConfig,
  AgentConfig,
  CreateAgentRequest,
  UpdateAgentRequest
} from '../src/shared/types';

const api = {
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  },
  workspace: {
    list: (): Promise<WorkspaceConfig[]> => ipcRenderer.invoke('workspace:list'),
    get: (): Promise<WorkspaceConfig> => ipcRenderer.invoke('workspace:get'),
    save: (cfg: WorkspaceConfig): Promise<boolean> => ipcRenderer.invoke('workspace:save', cfg)
  },
  llm: {
    getConfig: (): Promise<LLMConfig> => ipcRenderer.invoke('llm:config:get'),
    saveConfig: (cfg: LLMConfig): Promise<boolean> => ipcRenderer.invoke('llm:config:save', cfg),
    testConnection: (cfg: LLMConfig): Promise<{ success: boolean; latency?: number; model?: string; error?: string }> =>
      ipcRenderer.invoke('llm:test', cfg)
  },
  session: {
    list: (): Promise<Session[]> => ipcRenderer.invoke('session:list'),
    create: (title: string, agentId?: string): Promise<Session> => ipcRenderer.invoke('session:create', title, agentId),
    delete: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('session:delete', sessionId)
  },
  message: {
    list: (sessionId: string): Promise<ChatMessage[]> => ipcRenderer.invoke('message:list', sessionId)
  },
  chat: {
    send: (payload: ChatSendPayload): Promise<ChatMessage> => ipcRenderer.invoke('chat:send', payload),
    onStream: (cb: (chunk: { messageId: string; delta: string; done: boolean }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('chat:stream', handler);
      return () => ipcRenderer.removeListener('chat:stream', handler);
    }
  },
  memory: {
    search: (query: string, limit?: number): Promise<MemoryItem[]> =>
      ipcRenderer.invoke('memory:search', { query, limit }),
    add: (content: string, memoryType: string): Promise<boolean> =>
      ipcRenderer.invoke('memory:add', { content, memoryType })
  },
  tools: {
    list: (): Promise<MCPServerConfig[]> => ipcRenderer.invoke('tool:list'),
    onConfirm: (cb: (req: ToolConfirmRequest) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('tool:confirm:request', handler);
      return () => ipcRenderer.removeListener('tool:confirm:request', handler);
    },
    respondConfirm: (messageId: string, approved: boolean, modified?: string): Promise<void> =>
      ipcRenderer.invoke('tool:confirm:response', { messageId, approved, modified })
  },
  log: (msg: string) => ipcRenderer.send('app:log', msg),

  updater: {
    check: (): Promise<{ available: boolean; version?: string }> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: any; releaseDate?: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('update:available', handler);
      return () => ipcRenderer.removeListener('update:available', handler);
    },
    onUpdateNotAvailable: (cb: (info: { version: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('update:not-available', handler);
      return () => ipcRenderer.removeListener('update:not-available', handler);
    },
    onProgress: (cb: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
    onDownloaded: (cb: (info: { version: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('update:downloaded', handler);
      return () => ipcRenderer.removeListener('update:downloaded', handler);
    },
    onError: (cb: (err: string) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('update:error', handler);
      return () => ipcRenderer.removeListener('update:error', handler);
    }
  },
  agent: {
    list: (): Promise<AgentConfig[]> => ipcRenderer.invoke('agent:list'),
    get: (agentId: string): Promise<AgentConfig> => ipcRenderer.invoke('agent:get', agentId),
    create: (data: CreateAgentRequest): Promise<AgentConfig> => ipcRenderer.invoke('agent:create', data),
    update: (agentId: string, data: UpdateAgentRequest): Promise<AgentConfig> => ipcRenderer.invoke('agent:update', agentId, data),
    delete: (agentId: string): Promise<boolean> => ipcRenderer.invoke('agent:delete', agentId),
    toggleSkill: (agentId: string, skillId: string): Promise<boolean> => ipcRenderer.invoke('agent:skills:toggle', agentId, skillId)
  }
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
