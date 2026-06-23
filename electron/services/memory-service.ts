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

const MEMORY_DIR = path.join(os.homedir(), '.appclaw', 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'MEMORY.md');
const USER_FILE = path.join(MEMORY_DIR, 'USER.md');
const L1_TOKEN_LIMIT = 1300;
const NUDGE_INTERVAL = 10;
const COMPRESS_THRESHOLD = 30;
const RECENT_MESSAGES_KEEP = 20;
const SUMMARY_MAX_TOKENS = 500;

let turnCount = 0;

export function getMemoryDir(): string {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  return MEMORY_DIR;
}

export function loadL1Memory(): { memory: string; user: string } {
  getMemoryDir();
  const memory = fs.existsSync(MEMORY_FILE) ? fs.readFileSync(MEMORY_FILE, 'utf-8') : '';
  const user = fs.existsSync(USER_FILE) ? fs.readFileSync(USER_FILE, 'utf-8') : '';
  return { memory, user };
}

export function saveL1Memory(data: { memory: string; user: string }): boolean {
  try {
    getMemoryDir();
    fs.writeFileSync(MEMORY_FILE, truncateByTokens(data.memory, 800), 'utf-8');
    fs.writeFileSync(USER_FILE, truncateByTokens(data.user, 500), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function truncateByTokens(text: string, maxTokens: number): string {
  const avgCharsPerToken = 4;
  const maxChars = maxTokens * avgCharsPerToken;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

export async function searchL2(query: string, limit: number = 3): Promise<MemoryItem[]> {
  const searchTerm = `%${query}%`;
  const result = await getDb().query<MemoryItem>(
    `SELECT id, content, session_id as "memoryType", created_at as "createdAt"
     FROM messages
     WHERE role IN ('user', 'assistant') AND content LIKE $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [searchTerm, limit]
  );
  return result.rows;
}

export async function addL3Memory(content: string, memoryType: string = 'fact', sourceSession?: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO episodic_memory (id, content, memory_type, source_session, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, content.slice(0, 2000), memoryType, sourceSession || null, now]
  );
  return id;
}

export async function searchL3(query: string, limit: number = 5): Promise<MemoryItem[]> {
  const searchTerm = `%${query}%`;
  const result = await getDb().query<MemoryItem>(
    `SELECT id, content, memory_type as "memoryType", importance, access_count as "accessCount", created_at as "createdAt"
     FROM episodic_memory
     WHERE is_active = 1 AND content LIKE $1
     ORDER BY importance DESC, access_count DESC
     LIMIT $2`,
    [searchTerm, limit]
  );
  return result.rows;
}

export async function updateSkillStats(skillId: string, success: boolean): Promise<void> {
  const now = new Date().toISOString();
  const result = await getDb().query(
    'SELECT * FROM skill_memory WHERE skill_id = $1 LIMIT 1',
    [skillId]
  );
  if (result.rows.length > 0) {
    const row = result.rows[0];
    const updates = [
      `use_count = ${row.use_count + 1}`,
      success ? `success_count = ${row.success_count + 1}` : '',
      `last_used = '${now}'`,
      success ? `last_success = '${now}'` : ''
    ].filter(Boolean).join(', ');
    await getDb().query(
      `UPDATE skill_memory SET ${updates} WHERE skill_id = $1`,
      [skillId]
    );
  } else {
    await getDb().query(
      'INSERT INTO skill_memory (skill_id, use_count, success_count, last_used, last_success) VALUES ($1, $2, $3, $4, $5)',
      [skillId, 1, success ? 1 : 0, now, success ? now : null]
    );
  }
}

export async function buildContextMessages(sessionId: string, currentQuery: string): Promise<{ role: string; content: string; source?: string }[]> {
  const context: { role: string; content: string; source?: string }[] = [];

  const l1 = loadL1Memory();
  if (l1.memory || l1.user) {
    const l1Content = [];
    if (l1.memory) l1Content.push(`--- 环境信息 ---${l1.memory}`);
    if (l1.user) l1Content.push(`--- 用户信息 ---${l1.user}`);
    context.push({ role: 'system', content: l1Content.join('\n\n'), source: 'l1' });
  }

  const l2Results = await searchL2(currentQuery, 3);
  if (l2Results.length > 0) {
    const l2Content = l2Results.map((r, i) => `[历史${i + 1}] ${r.content}`).join('\n');
    context.push({ role: 'system', content: `--- 相关历史 ---${l2Content}`, source: 'l2' });
  }

  const l3Results = await searchL3(currentQuery, 3);
  if (l3Results.length > 0) {
    const l3Content = l3Results.map(r => `[${r.memoryType}] ${r.content}`).join('\n');
    context.push({ role: 'system', content: `--- 长期记忆 ---${l3Content}`, source: 'l3' });
  }

  const allMessages = await listMessages(sessionId);
  if (allMessages.length > COMPRESS_THRESHOLD) {
    const summary = await getOrGenerateSummary(sessionId, allMessages.slice(0, -RECENT_MESSAGES_KEEP));
    if (summary) {
      context.push({ role: 'system', content: `--- 对话摘要 ---\n${summary}`, source: 'summary' });
    }
  }

  const recentMessages = allMessages.slice(-RECENT_MESSAGES_KEEP);
  for (const m of recentMessages) {
    if (m.role === 'tool') continue;
    context.push({
      role: m.role,
      content: m.content || '',
      source: 'session'
    });
  }

  return context;
}

async function getOrGenerateSummary(sessionId: string, earlyMessages: ChatMessage[]): Promise<string | null> {
  const sessionResult = await getDb().query('SELECT summary FROM sessions WHERE id = $1', [sessionId]);
  if (sessionResult.rows.length > 0 && sessionResult.rows[0].summary) {
    return sessionResult.rows[0].summary as string;
  }

  const summary = await generateConversationSummary(earlyMessages);
  if (summary) {
    await getDb().query('UPDATE sessions SET summary = $1, updated_at = $2 WHERE id = $3',
      [summary, new Date().toISOString(), sessionId]);
  }
  return summary;
}

async function generateConversationSummary(messages: ChatMessage[]): Promise<string | null> {
  try {
    const { getLLMConfig } = await import('./llm-provider');
    const cfg = getLLMConfig();
    if (!cfg?.apiKey) return null;

    const { OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      baseURL: cfg.baseUrl || undefined,
    });

    const conversationText = messages
      .filter(m => m.role !== 'tool' && m.content)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')
      .slice(0, 8000);

    const resp = await client.chat.completions.create({
      model: cfg.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '请用简洁的中文总结下面的对话内容，保留关键信息、决策和结果。控制在300字以内。' },
        { role: 'user', content: conversationText }
      ],
      max_tokens: 300,
      temperature: 0.3
    });

    return resp.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function triggerNudge(sessionId: string): Promise<void> {
  turnCount++;
  if (turnCount < NUDGE_INTERVAL) return;
  turnCount = 0;

  const messages = await listMessages(sessionId);
  const recentMessages = messages.slice(-10);
  const extracted = extractMemoryFromMessages(recentMessages);

  for (const item of extracted) {
    await addL3Memory(item.content, item.type, sessionId);
  }

  await consolidateMemory();
}

function extractMemoryFromMessages(messages: ChatMessage[]): { content: string; type: string }[] {
  const extracted: { content: string; type: string }[] = [];
  const keywords = ['记住', '我叫', '我的名字', '我住', '我喜欢', '偏好', '设置', '配置'];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const content = msg.content || '';
    for (const kw of keywords) {
      if (content.includes(kw)) {
        extracted.push({ content: content.slice(0, 500), type: 'fact' });
        break;
      }
    }
  }

  return extracted;
}

async function consolidateMemory(): Promise<void> {
  const result = await getDb().query(
    'SELECT id, content, memory_type, importance FROM episodic_memory WHERE is_active = 1 ORDER BY importance DESC, created_at DESC'
  );
  const memories = result.rows;
  const seen = new Set<string>();
  const toDeactivate: string[] = [];

  for (const mem of memories) {
    const key = mem.content.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) {
      toDeactivate.push(mem.id);
    } else {
      seen.add(key);
    }
  }

  for (const id of toDeactivate) {
    await getDb().query('UPDATE episodic_memory SET is_active = 0 WHERE id = $1', [id]);
  }
}
