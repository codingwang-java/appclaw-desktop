/// <reference types="vite/client" />

import type {
  ChatSendPayload,
  Session,
  ChatMessage,
  MemoryItem,
  WorkspaceConfig,
  LLMConfig,
  ToolConfirmRequest,
  MCPServerConfig,
  ToolResult
} from './shared/types';

declare global {
  interface Window {
    api: {
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
      };
      workspace: {
        list: () => Promise<WorkspaceConfig[]>;
        get: () => Promise<WorkspaceConfig>;
        save: (cfg: WorkspaceConfig) => Promise<boolean>;
      };
      llm: {
        getConfig: () => Promise<LLMConfig>;
        saveConfig: (cfg: LLMConfig) => Promise<boolean>;
        testConnection: (cfg: LLMConfig) => Promise<{ success: boolean; latency?: number; model?: string; error?: string }>;
      };
      session: {
        list: () => Promise<Session[]>;
        create: (title: string) => Promise<Session>;
        delete: (id: string) => Promise<boolean>;
      };
      message: {
        list: (sessionId: string) => Promise<ChatMessage[]>;
      };
      chat: {
        send: (payload: ChatSendPayload) => Promise<ChatMessage>;
        onStream: (
          cb: (chunk: { messageId: string; delta: string; done: boolean }) => void
        ) => void;
      };
      memory: {
        search: (query: string, limit?: number) => Promise<MemoryItem[]>;
        add: (content: string, memoryType?: string) => Promise<boolean>;
      };
      tools: {
        list: () => Promise<MCPServerConfig[]>;
        onConfirm: (cb: (req: ToolConfirmRequest) => void) => void;
        respondConfirm: (messageId: string, approved: boolean, modified?: string) => Promise<void>;
      };
      updater: {
        check: () => Promise<{ available: boolean; version?: string; error?: string }>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: any; releaseDate?: string }) => void) => () => void;
        onUpdateNotAvailable: (cb: (info: { version: string }) => void) => () => void;
        onProgress: (cb: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => () => void;
        onDownloaded: (cb: (info: { version: string }) => void) => () => void;
        onError: (cb: (err: string) => void) => () => void;
      };
    };
  }
}

export {};
