export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  tools: string[];
  toolPermissions: Record<string, ToolPermission>;
  skills?: string[];
}

export interface ToolPermission {
  requireConfirm: boolean;
  maxPerSession?: number;
  allowlist?: string[];
  blocklist?: string[];
  sandboxPath?: string;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  enabled: boolean;
  priority: number;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  avatar?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  tools?: string[];
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  avatar?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  tools?: string[];
}

export interface AgentMemoryRequest {
  agentId: string;
  content: string;
  memoryType?: string;
}

export interface AgentSkillRequest {
  agentId: string;
  skillId: string;
  enabled?: boolean;
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

export interface SkillParameter {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required: boolean;
  default?: string;
  options?: string[];
  placeholder?: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  trigger: string;
  type: 'declarative' | 'code';
  tools: string[];
  parameters: SkillParameter[];
  enabled: boolean;
  source: 'local' | 'marketplace' | 'import';
  installedAt: string;
}

export interface SkillExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
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
  | 'app:log'
  | 'agent:list'
  | 'agent:get'
  | 'agent:create'
  | 'agent:update'
  | 'agent:delete'
  | 'agent:skills:list'
  | 'agent:skills:add'
  | 'agent:skills:remove'
  | 'agent:skills:toggle'
  | 'agent:memory:search'
  | 'agent:memory:add';

export interface ChatSendPayload {
  sessionId: string;
  message: string;
  agentId: string;
}
