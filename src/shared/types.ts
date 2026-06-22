export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  tools: string[];
  toolPermissions: Record<string, ToolPermission>;
}

export interface ToolPermission {
  requireConfirm: boolean;
  maxPerSession?: number;
  allowlist?: string[];
  blocklist?: string[];
  sandboxPath?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: string;
  createdAt: string;
  pending?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export interface ToolConfirmRequest {
  messageId: string;
  toolName: string;
  args: Record<string, any>;
  preview: string;
  risk: 'low' | 'medium' | 'high';
}

export interface Session {
  id: string;
  title: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  memoryType: string;
  similarity?: number;
  createdAt: string;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'deepseek' | 'ollama' | 'custom';
  apiKey: string;
  baseUrl?: string;
  model: string;
  embeddingModel?: string;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  path: string;
  agents: AgentConfig[];
  llm: LLMConfig;
  mcpServers: MCPServerConfig[];
}

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export type IpcChannel =
  | 'workspace:list'
  | 'workspace:get'
  | 'workspace:save'
  | 'llm:config:get'
  | 'llm:config:save'
  | 'chat:send'
  | 'chat:stream'
  | 'session:list'
  | 'session:create'
  | 'session:delete'
  | 'message:list'
  | 'memory:search'
  | 'memory:add'
  | 'tool:confirm:request'
  | 'tool:confirm:response'
  | 'tool:list'
  | 'app:log';

export interface ChatSendPayload {
  sessionId: string;
  message: string;
  agentId: string;
}
