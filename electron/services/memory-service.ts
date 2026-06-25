import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, Session, MemoryItem, AgentConfig } from '../../src/shared/types';
import { listSkills } from './skill-manager';

let db: PGlite | null = null;

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  system_prompt TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  tools TEXT NOT NULL DEFAULT '[]',
  tool_permissions TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS agents ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE IF EXISTS agents ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT,
  tool_calls TEXT,
  tool_result TEXT,
  tool_call_id TEXT,
  token_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  embedding TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  raw_context TEXT,
  tags TEXT DEFAULT '[]',
  source_session TEXT,
  source_message TEXT,
  embedding TEXT,
  importance INTEGER DEFAULT 3,
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS long_term_memory ADD COLUMN IF NOT EXISTS agent_id TEXT;

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled SMALLINT NOT NULL DEFAULT 1,
  priority INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool_name TEXT NOT NULL,
  arguments TEXT,
  result_preview TEXT,
  success SMALLINT NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  user_approved SMALLINT DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value TEXT,
  category TEXT,
  confidence REAL DEFAULT 1.0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episodic_memory (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  importance INTEGER DEFAULT 3,
  source_session TEXT,
  access_count INTEGER DEFAULT 0,
  last_accessed TIMESTAMPTZ,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE IF EXISTS episodic_memory ADD COLUMN IF NOT EXISTS agent_id TEXT;

CREATE TABLE IF NOT EXISTS skill_memory (
  skill_id TEXT PRIMARY KEY,
  use_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,
  last_success TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_type ON long_term_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_active ON long_term_memory(is_active);
CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_episodic_active ON episodic_memory(is_active);
CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON long_term_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills ON agent_skills(agent_id);

INSERT INTO agents (id, name, model, system_prompt, temperature, tools, tool_permissions)
VALUES (
  'default-agent',
  'AppClaw',
  'gpt-4o-mini',
  '你是 AppClaw，一个强大的桌面 AI 助手。你可以通过工具调用操作系统程序、操作桌面（截图、鼠标点击、键盘输入）、浏览器、文件系统等。请用中文回复，回答简洁专业。当用户请求超出对话范围的操作时，使用相应的工具来完成任务。对于涉及修改、发送、执行的操作，始终确保用户已经确认。',
  0.7,
  '["filesystem", "browser", "shell", "memory", "desktop"]',
  '{"fs_write_file": {"requireConfirm": true}, "shell_exec": {"requireConfirm": true}, "email_send": {"requireConfirm": true}, "desktop_click": {"requireConfirm": true}, "desktop_double_click": {"requireConfirm": true}, "desktop_type": {"requireConfirm": true}, "desktop_press_key": {"requireConfirm": true}}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, name, description, model, system_prompt, temperature, tools, tool_permissions)
VALUES (
  'office-assistant',
  '办公助手',
  '专业的办公效率助手，帮助处理文档、邮件、日程安排等办公任务',
  'gpt-4o-mini',
  '你是一个专业的办公效率助手。你的专长包括：\n1. 文档处理：撰写、编辑、格式化各类办公文档\n2. 邮件处理：撰写邮件、回复邮件、邮件分类\n3. 日程管理：安排会议、提醒事项\n4. 数据分析：Excel 公式、数据统计\n5. 报告撰写：工作总结、项目报告、PPT 文案\n\n请用专业、简洁的中文回复。遇到不确定的信息时，主动询问用户。对于涉及修改文件或发送邮件的操作，必须先确认。',
  0.5,
  '["filesystem", "browser", "memory"]',
  '{"fs_write_file": {"requireConfirm": true}}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, name, description, model, system_prompt, temperature, tools, tool_permissions)
VALUES (
  'stock-trader',
  '股票交易助手',
  '专业的股票市场分析和交易辅助助手',
  'gpt-4o-mini',
  '你是一个专业的股票市场分析助手。你的专长包括：\n1. 股票查询：查询股票价格、涨跌幅、成交量\n2. 市场分析：技术分析、基本面分析\n3. 投资建议：基于市场数据提供投资建议\n4. 交易记录：记录交易、计算收益\n5. 行情监控：关注股票动态、提醒关键点位\n\n⚠️ 免责声明：你提供的所有分析和建议仅供参考，不构成投资建议。投资有风险，入市需谨慎。\n\n请用专业、客观的中文回复。对于涉及真实交易的操作，必须先确认。',
  0.3,
  '["browser", "memory"]',
  '{}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, agent_id, title, created_at, updated_at)
VALUES ('welcome-session', 'default-agent', '欢迎会话', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, session_id, role, content, created_at)
VALUES (
  'welcome-msg',
  'welcome-session',
  'assistant',
  '你好！我是 AppClaw 桌面助手\n\n我可以帮你：\n- 进行对话和问答\n- 操控桌面（截图、点击、键盘输入）\n- 操作浏览器搜索信息\n- 读写本地文件\n- 执行系统命令\n- 启动桌面程序\n- 记住重要信息\n\n开始输入你的问题吧！',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profile (key, value, category, confidence)
VALUES ('language', 'zh-CN', 'preference', 1.0)
ON CONFLICT (key) DO NOTHING;
`;

export async function initDatabase(dbPath: string): Promise<PGlite> {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new PGlite(dbPath);

  const statements = INIT_SQL
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await db.exec(stmt);
    } catch (err) {
      console.debug('SQL statement (may already exist):', err);
    }
  }

  return db;
}

export function getDb(): PGlite {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export async function listSessions(): Promise<Session[]> {
  const result = await getDb().query<Session>(
    `SELECT id, agent_id as "agentId", title, created_at as "createdAt", updated_at as "updatedAt"
     FROM sessions ORDER BY updated_at DESC`
  );
  return result.rows;
}

export async function createSession(title: string, agentId: string = 'default-agent'): Promise<Session> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
    [id, agentId, title, now, now]
  );
  return { id, agentId, title, createdAt: now, updatedAt: now };
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  await getDb().query('DELETE FROM messages WHERE session_id = $1', [sessionId]);
  await getDb().query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  return true;
}

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const result = await getDb().query<ChatMessage>(
    `SELECT id, session_id as "sessionId", role, content,
            tool_calls as "toolCalls", tool_result as "toolResult",
            created_at as "createdAt"
     FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows.map((row) => ({
    ...row,
    toolCalls: row.toolCalls ? JSON.parse(row.toolCalls as unknown as string) : undefined
  })) as ChatMessage[];
}

export async function saveMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }): Promise<ChatMessage> {
  const id = msg.id || uuidv4();
  const now = new Date().toISOString();
  const toolCallsStr = msg.toolCalls ? JSON.stringify(msg.toolCalls) : null;

  await getDb().query(
    `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_result, tool_call_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, msg.sessionId, msg.role, msg.content || null, toolCallsStr, msg.toolResult || null, null, now]
  );

  await getDb().query('UPDATE sessions SET updated_at = $1 WHERE id = $2', [now, msg.sessionId]);

  return { ...msg, id, createdAt: now } as ChatMessage;
}

export async function searchMemory(query: string, limit: number = 5): Promise<MemoryItem[]> {
  const searchTerm = `%${query}%`;
  const result = await getDb().query<MemoryItem>(
    `SELECT id, content, memory_type as "memoryType", created_at as "createdAt"
     FROM long_term_memory
     WHERE is_active = 1 AND (content LIKE $1 OR memory_type LIKE $2)
     ORDER BY importance DESC, created_at DESC
     LIMIT $3`,
    [searchTerm, searchTerm, limit]
  );
  return result.rows;
}

export async function addMemory(content: string, memoryType: string = 'fact'): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO long_term_memory (id, content, memory_type, created_at) VALUES ($1, $2, $3, $4)',
    [id, content, memoryType, now]
  );
  return id;
}

export async function getAgent(agentId: string): Promise<AgentConfig | null> {
  const result = await getDb().query(
    'SELECT * FROM agents WHERE id = $1 LIMIT 1',
    [agentId]
  );
  if (result.rows.length === 0) return null;
  const row: any = result.rows[0];
  const skills = await getAgentSkills(agentId);
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    avatar: row.avatar || undefined,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    tools: JSON.parse(row.tools || '[]'),
    toolPermissions: JSON.parse(row.tool_permissions || '{}'),
    skills
  };
}

export async function listAgents(): Promise<AgentConfig[]> {
  const result = await getDb().query('SELECT * FROM agents ORDER BY created_at');
  const agents: AgentConfig[] = [];
  for (const row of result.rows as any[]) {
    const skills = await getAgentSkills(row.id);
    agents.push({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      avatar: row.avatar || undefined,
      model: row.model,
      systemPrompt: row.system_prompt,
      temperature: row.temperature,
      tools: JSON.parse(row.tools || '[]'),
      toolPermissions: JSON.parse(row.tool_permissions || '{}'),
      skills
    });
  }
  return agents;
}

export async function createAgent(data: { name: string; description?: string; avatar?: string; model?: string; systemPrompt?: string; temperature?: number; tools?: string[] }): Promise<AgentConfig> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    `INSERT INTO agents (id, name, description, avatar, model, system_prompt, temperature, tools, tool_permissions, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      data.name,
      data.description || '',
      data.avatar || '',
      data.model || 'gpt-4o-mini',
      data.systemPrompt || '',
      data.temperature || 0.7,
      JSON.stringify(data.tools || []),
      JSON.stringify({}),
      now,
      now
    ]
  );
  return {
    id,
    name: data.name,
    description: data.description || undefined,
    avatar: data.avatar || undefined,
    model: data.model || 'gpt-4o-mini',
    systemPrompt: data.systemPrompt || '',
    temperature: data.temperature || 0.7,
    tools: data.tools || [],
    toolPermissions: {},
    skills: []
  };
}

export async function updateAgent(agentId: string, data: { name?: string; description?: string; avatar?: string; model?: string; systemPrompt?: string; temperature?: number; tools?: string[] }): Promise<AgentConfig> {
  const updates: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { updates.push(`name = $${idx++}`); params.push(data.name); }
  if (data.description !== undefined) { updates.push(`description = $${idx++}`); params.push(data.description); }
  if (data.avatar !== undefined) { updates.push(`avatar = $${idx++}`); params.push(data.avatar); }
  if (data.model !== undefined) { updates.push(`model = $${idx++}`); params.push(data.model); }
  if (data.systemPrompt !== undefined) { updates.push(`system_prompt = $${idx++}`); params.push(data.systemPrompt); }
  if (data.temperature !== undefined) { updates.push(`temperature = $${idx++}`); params.push(data.temperature); }
  if (data.tools !== undefined) { updates.push(`tools = $${idx++}`); params.push(JSON.stringify(data.tools)); }

  if (updates.length > 0) {
    updates.push(`updated_at = $${idx++}`);
    params.push(new Date().toISOString());
    params.push(agentId);
    await getDb().query(`UPDATE agents SET ${updates.join(', ')} WHERE id = $${idx}`, params);
  }

  const agent = await getAgent(agentId);
  if (!agent) throw new Error('Agent not found');
  return agent;
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  await getDb().query('DELETE FROM agent_skills WHERE agent_id = $1', [agentId]);
  await getDb().query('DELETE FROM sessions WHERE agent_id = $1', [agentId]);
  await getDb().query('DELETE FROM long_term_memory WHERE agent_id = $1', [agentId]);
  await getDb().query('DELETE FROM episodic_memory WHERE agent_id = $1', [agentId]);
  await getDb().query('DELETE FROM agents WHERE id = $1', [agentId]);
  return true;
}

export async function getAgentSkills(agentId: string): Promise<string[]> {
  const result = await getDb().query(
    'SELECT skill_id FROM agent_skills WHERE agent_id = $1 AND enabled = 1 ORDER BY priority',
    [agentId]
  );
  const skillIds = result.rows.map((row: any) => row.skill_id);
  if (skillIds.length === 0) return [];
  const allSkills = await listSkills();
  const skillMap = new Map(allSkills.map(s => [s.id, s.name]));
  return skillIds.map(id => skillMap.get(id) || id);
}

export async function addAgentSkill(agentId: string, skillId: string): Promise<void> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO agent_skills (id, agent_id, skill_id, enabled, priority, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (agent_id, skill_id) DO UPDATE SET enabled = 1',
    [id, agentId, skillId, 1, 100, now]
  );
}

export async function removeAgentSkill(agentId: string, skillId: string): Promise<void> {
  await getDb().query('DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2', [agentId, skillId]);
}

export async function toggleAgentSkill(agentId: string, skillId: string): Promise<boolean> {
  const result = await getDb().query(
    'SELECT enabled FROM agent_skills WHERE agent_id = $1 AND skill_id = $2 LIMIT 1',
    [agentId, skillId]
  );

  if (result.rows.length === 0) {
    await addAgentSkill(agentId, skillId);
    return true;
  }

  const currentEnabled = (result.rows[0] as any).enabled === 1;
  await getDb().query(
    'UPDATE agent_skills SET enabled = $1 WHERE agent_id = $2 AND skill_id = $3',
    [currentEnabled ? 0 : 1, agentId, skillId]
  );
  return !currentEnabled;
}

export async function searchAgentMemory(agentId: string, query: string, limit: number = 5): Promise<MemoryItem[]> {
  const searchTerm = `%${query}%`;
  const result = await getDb().query<MemoryItem>(
    `SELECT id, content, memory_type as "memoryType", created_at as "createdAt"
     FROM long_term_memory
     WHERE is_active = 1 AND agent_id = $1 AND (content LIKE $2 OR memory_type LIKE $3)
     ORDER BY importance DESC, created_at DESC
     LIMIT $4`,
    [agentId, searchTerm, searchTerm, limit]
  );
  return result.rows;
}

export async function addAgentMemory(agentId: string, content: string, memoryType: string = 'fact'): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO long_term_memory (id, agent_id, content, memory_type, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, agentId, content, memoryType, now]
  );
  return id;
}

export async function addL3Memory(content: string, memoryType: string = 'fact', sourceSession?: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO long_term_memory (id, content, memory_type, source_session, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, content, memoryType, sourceSession || null, now]
  );
  return id;
}

export async function searchL3(query: string, limit: number = 5): Promise<MemoryItem[]> {
  const searchTerm = `%${query}%`;
  const result = await getDb().query<MemoryItem>(
    `SELECT id, content, memory_type as "memoryType", created_at as "createdAt"
     FROM long_term_memory
     WHERE is_active = 1 AND (content LIKE $1 OR memory_type LIKE $2)
     ORDER BY importance DESC, created_at DESC
     LIMIT $3`,
    [searchTerm, searchTerm, limit]
  );
  return result.rows;
}

export async function loadL1Memory(): Promise<{ memory: string; user: string }> {
  return { memory: '', user: '' };
}

export async function saveL1Memory(data: { memory: string; user: string }): Promise<void> {
  return;
}

export async function searchL2(query: string, limit: number = 3): Promise<any[]> {
  return [];
}

export async function buildContextMessages(sessionId: string, currentQuery: string, agentId?: string): Promise<{ role: string; content: string; source?: string }[]> {
  const context: { role: string; content: string; source?: string }[] = [];
  const messages = await listMessages(sessionId);
  const recentMessages = messages.slice(-10);
  
  for (const msg of recentMessages) {
    context.push({ role: msg.role, content: msg.content || '', source: 'session' });
  }

  if (agentId) {
    const agentL3Results = await searchAgentMemory(agentId, currentQuery, 3);
    if (agentL3Results.length > 0) {
      const l3Content = agentL3Results.map(r => `[${r.memoryType}] ${r.content}`).join('\n');
      context.push({ role: 'system', content: `--- Agent 记忆 ---${l3Content}`, source: 'agent-l3' });
    }
  }

  const globalL3Results = await searchL3(currentQuery, 3);
  if (globalL3Results.length > 0) {
    const l3Content = globalL3Results.map(r => `[${r.memoryType}] ${r.content}`).join('\n');
    context.push({ role: 'system', content: `--- 长期记忆 ---${l3Content}`, source: 'global-l3' });
  }

  return context;
}

export async function logToolExecution(sessionId: string, toolName: string, args: Record<string, any>, success: boolean, durationMs: number, userApproved: boolean, errorMessage?: string): Promise<void> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    `INSERT INTO tool_executions (id, session_id, tool_name, arguments, result_preview, success, duration_ms, user_approved, error_message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, sessionId, toolName, JSON.stringify(args), '', success ? 1 : 0, durationMs, userApproved ? 1 : 0, errorMessage || null, now]
  );
}

export async function triggerNudge(sessionId: string): Promise<void> {
  return;
}

