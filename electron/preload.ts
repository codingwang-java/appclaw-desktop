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
  UpdateAgentRequest,
  SkillInfo,
  SkillExecutionResult
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
    delete: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('session:delete', sessionId),
    onRenamed: (cb: (data: { sessionId: string; title: string }) => void) => {
      const handler = (_e: any, data: any) => cb(data);
      ipcRenderer.on('session:renamed', handler);
      return () => ipcRenderer.removeListener('session:renamed', handler);
    }
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
      ipcRenderer.invoke('memory:add', { content, memoryType }),
    l1: {
      get: (): Promise<{ memory: string; user: string }> => ipcRenderer.invoke('memory:l1:get'),
      save: (data: { memory: string; user: string }): Promise<void> => ipcRenderer.invoke('memory:l1:save', data)
    },
    l2: {
      search: (query: string, limit?: number): Promise<any[]> => ipcRenderer.invoke('memory:l2:search', { query, limit })
    },
    list: (agentId?: string, limit?: number): Promise<MemoryItem[]> => ipcRenderer.invoke('memory:list', { agentId, limit }),
    delete: (memoryId: string): Promise<boolean> => ipcRenderer.invoke('memory:delete', memoryId),
    update: (id: string, content: string, importance?: number): Promise<boolean> => ipcRenderer.invoke('memory:update', { id, content, importance })
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
  },
  skill: {
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke('skill:list'),
    execute: (skillId: string, params: Record<string, string>): Promise<SkillExecutionResult> =>
      ipcRenderer.invoke('skill:execute', skillId, params),
    delete: (skillId: string): Promise<boolean> => ipcRenderer.invoke('skill:delete', skillId),
    create: (skill: any): Promise<boolean> => ipcRenderer.invoke('skill:create', skill),
    save: (skillId: string, updates: any): Promise<boolean> => ipcRenderer.invoke('skill:save', skillId, updates),
    getPrompt: (skillId: string): Promise<string | null> => ipcRenderer.invoke('skill:getPrompt', skillId),
    exists: (skillId: string): Promise<boolean> => ipcRenderer.invoke('skill:exists', skillId),
    export: (skillId: string): Promise<string> => ipcRenderer.invoke('skill:export', skillId),
    import: (zipBase64: string): Promise<SkillInfo> => ipcRenderer.invoke('skill:import', zipBase64),
    marketplace: {
      search: (query: string): Promise<any[]> => ipcRenderer.invoke('skill:marketplace:search', query),
      install: (skillUrl: string): Promise<SkillInfo | null> => ipcRenderer.invoke('skill:marketplace:install', skillUrl)
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
