import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ChatMessage, Session, MemoryItem, AgentConfig } from '../../src/shared/types';

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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_type ON long_term_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_active ON long_term_memory(is_active);
CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_executions(session_id);

INSERT INTO agents (id, name, model, system_prompt, temperature, tools, tool_permissions)
VALUES (
  'default-agent',
  'AppClaw',
  'gpt-4o-mini',
  '你是 AppClaw，一个强大的桌面 AI 助手。你可以通过工具调用操作系统程序、浏览器、文件系统等。请用中文回复，回答简洁专业。当用户请求超出对话范围的操作时，使用相应的工具来完成任务。对于涉及修改、发送、执行的操作，始终确保用户已经确认。',
  0.7,
  '["filesystem", "browser", "shell", "memory"]',
  '{"fs_write_file": {"requireConfirm": true}, "shell_exec": {"requireConfirm": true}, "email_send": {"requireConfirm": true}}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, agent_id, title, created_at, updated_at)
VALUES ('welcome-session', 'default-agent', '欢迎会话', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO messages (id, session_id, role, content, created_at)
VALUES (
  'welcome-msg',
  'welcome-session',
  'assistant',
  '你好！我是 AppClaw 桌面助手\n\n我可以帮你：\n- 进行对话和问答\n- 操作浏览器搜索信息\n- 读写本地文件\n- 执行系统命令\n- 启动桌面程序\n- 记住重要信息\n\n开始输入你的问题吧！',
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

export async function buildContextMessages(sessionId: string, currentQuery: string): Promise<{ role: string; content: string }[]> {
  const allMessages = await listMessages(sessionId);
  const recentMessages = allMessages.slice(-20);

  const contextMessages: { role: string; content: string }[] = [];

  const memories = await searchMemory(currentQuery, 3);
  if (memories.length > 0) {
    const memoryText = memories
      .map((m, i) => `[记忆${i + 1}] ${m.content}`)
      .join('\n');
    contextMessages.push({
      role: 'system',
      content: `相关长期记忆：\n${memoryText}\n\n以上信息来自之前的对话积累，如有相关可参考使用。`
    });
  }

  for (const m of recentMessages) {
    if (m.role === 'tool') continue;
    if (m.role === 'assistant' && m.toolCalls) {
      contextMessages.push({
        role: 'assistant',
        content: m.content || ''
      });
    } else {
      contextMessages.push({
        role: m.role,
        content: m.content || ''
      });
    }
  }

  return contextMessages;
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
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    tools: JSON.parse(row.tools || '[]'),
    toolPermissions: JSON.parse(row.tool_permissions || '{}')
  };
}

export async function listAgents(): Promise<AgentConfig[]> {
  const result = await getDb().query('SELECT * FROM agents ORDER BY created_at');
  return result.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    tools: JSON.parse(row.tools || '[]'),
    toolPermissions: JSON.parse(row.tool_permissions || '{}')
  }));
}

export async function logToolExecution(sessionId: string, toolName: string, args: any, success: boolean, durationMs: number, userApproved: boolean, errorMessage?: string): Promise<void> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const argsStr = typeof args === 'string' ? args.slice(0, 500) : JSON.stringify(args || {}).slice(0, 500);
  await getDb().query(
    `INSERT INTO tool_executions (id, session_id, tool_name, arguments, success, duration_ms, user_approved, error_message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, sessionId, toolName, argsStr, success ? 1 : 0, durationMs, userApproved ? 1 : 0, errorMessage || null, now]
  );
}
