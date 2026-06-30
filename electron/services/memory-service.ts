import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
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

-- Vector memory support
CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT PRIMARY KEY REFERENCES long_term_memory(id) ON DELETE CASCADE,
  embedding VECTOR(1536)
);

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

  // 检测并修复损坏的数据库文件（空文件或上次启动未完成写入的文件）
  let useDbPath = dbPath;
  if (fs.existsSync(dbPath)) {
    try {
      const stat = fs.statSync(dbPath);
      if (stat.size === 0) {
        console.warn('[DB] Detected corrupt 0-byte database file, removing...');
        try { fs.unlinkSync(dbPath); } catch (e) {
          console.warn('[DB] Cannot delete corrupt file (locked?), using fallback path');
          useDbPath = dbPath + '.fresh';
        }
      }
    } catch (e) {
      console.warn('[DB] Failed to check/remove corrupt database file:', e);
    }
  }

  // 如果主路径文件被锁不可删除，使用备用路径
  if (useDbPath !== dbPath && fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath);
    if (stat.size > 0) {
      // 文件恢复正常，使用主路径
      useDbPath = dbPath;
    }
  }

  try {
    db = new PGlite(useDbPath, { extensions: { vector } });
  } catch (e) {
    console.error('[DB] PGlite initialization failed, attempting recovery...', e);
    // 如果初始化失败，尝试删除文件重新创建
    if (useDbPath === dbPath) {
      try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
    } else {
      try { if (fs.existsSync(useDbPath)) fs.unlinkSync(useDbPath); } catch {}
    }
    db = new PGlite(dbPath, { extensions: { vector } });
  }

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

export async function getAgentSkillIds(agentId: string): Promise<string[]> {
  const result = await getDb().query(
    'SELECT skill_id FROM agent_skills WHERE agent_id = $1 AND enabled = 1 ORDER BY priority',
    [agentId]
  );
  return result.rows.map((row: any) => row.skill_id);
}

export async function getEpisodicMemory(sessionId: string, limit: number = 5): Promise<any[]> {
  try {
    const result = await getDb().query(
      `SELECT id, content, memory_type as "memoryType", importance, created_at as "createdAt"
       FROM episodic_memory
       WHERE source_session = $1 AND is_active = 1
       ORDER BY importance DESC, created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows;
  } catch { return []; }
}

export async function addEpisodicMemory(sessionId: string, content: string, memoryType: string = 'summary', importance: number = 3): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO episodic_memory (id, content, memory_type, importance, source_session, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, content, memoryType, importance, sessionId, now]
  );
  return id;
}

export async function listAllMemories(agentId?: string, limit: number = 50): Promise<MemoryItem[]> {
  let query = `SELECT id, content, memory_type as "memoryType", importance, access_count as "accessCount", created_at as "createdAt"
     FROM long_term_memory WHERE is_active = 1`;
  const params: any[] = [];
  if (agentId) {
    query += ' AND agent_id = $1';
    params.push(agentId);
  }
  query += ' ORDER BY importance DESC, created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);
  const result = await getDb().query<MemoryItem>(query, params);
  return result.rows;
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
  await getDb().query('DELETE FROM long_term_memory WHERE id = $1', [memoryId]);
  return true;
}

export async function updateMemory(memoryId: string, content: string, importance?: number): Promise<boolean> {
  const updates: string[] = ['content = $1'];
  const params: any[] = [content];
  if (importance !== undefined) {
    updates.push('importance = $2');
    params.push(importance);
  }
  params.push(memoryId);
  await getDb().query(`UPDATE long_term_memory SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
  return true;
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await getDb().query('UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3', [title, new Date().toISOString(), sessionId]);
}

export async function consolidateMemories(agentId: string): Promise<number> {
  const result = await getDb().query(
    `SELECT id, content FROM long_term_memory WHERE agent_id = $1 AND is_active = 1 ORDER BY created_at`,
    [agentId]
  );
  const memories = result.rows as any[];
  let consolidated = 0;

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i].content.toLowerCase();
      const b = memories[j].content.toLowerCase();
      const similarity = jaccardSimilarity(a, b);
      if (similarity > 0.6) {
        const merged = a.length >= b.length ? memories[i].content : memories[j].content;
        const toDelete = a.length >= b.length ? memories[j].id : memories[i].id;
        await getDb().query('UPDATE long_term_memory SET content = $1, importance = importance + 1 WHERE id = $2', [merged, a.length >= b.length ? memories[i].id : memories[j].id]);
        await getDb().query('UPDATE long_term_memory SET is_active = 0 WHERE id = $1', [toDelete]);
        consolidated++;
      }
    }
  }
  return consolidated;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  return intersection.size / (setA.size + setB.size - intersection.size);
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
  const defaultWorkspaceDir = path.join(homedir(), '.appclaw', 'workspaces', 'default');
  const memoryPath = path.join(defaultWorkspaceDir, 'MEMORY.md');
  const userPath = path.join(defaultWorkspaceDir, 'USER.md');
  
  let memory = '';
  let user = '';
  
  try {
    if (fs.existsSync(memoryPath)) {
      memory = fs.readFileSync(memoryPath, 'utf-8');
    }
    if (fs.existsSync(userPath)) {
      user = fs.readFileSync(userPath, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to load L1 memory:', err);
  }
  
  return { memory, user };
}

export async function saveL1Memory(data: { memory: string; user: string }): Promise<void> {
  const defaultWorkspaceDir = path.join(homedir(), '.appclaw', 'workspaces', 'default');
  if (!fs.existsSync(defaultWorkspaceDir)) {
    fs.mkdirSync(defaultWorkspaceDir, { recursive: true });
  }
  const memoryPath = path.join(defaultWorkspaceDir, 'MEMORY.md');
  const userPath = path.join(defaultWorkspaceDir, 'USER.md');
  
  try {
    fs.writeFileSync(memoryPath, data.memory || '', 'utf-8');
    fs.writeFileSync(userPath, data.user || '', 'utf-8');
  } catch (err) {
    console.error('Failed to save L1 memory:', err);
  }
}

export async function searchL2(query: string, limit: number = 3): Promise<any[]> {
  try {
    const result = await getDb().query<any>(
      `SELECT id, session_id as "sessionId", role, content, created_at as "createdAt"
       FROM messages
       WHERE role IN ('user', 'assistant') AND content IS NOT NULL AND content != ''
         AND (
           to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
           OR content LIKE $2
         )
       ORDER BY created_at DESC
       LIMIT $3`,
      [query, `%${query}%`, limit]
    );
    return result.rows;
  } catch (err) {
    console.error('Search L2 memory failed:', err);
    return [];
  }
}

export async function buildContextMessages(sessionId: string, currentQuery: string, agentId?: string): Promise<{ role: string; content: string; source?: string }[]> {
  const context: { role: string; content: string; source?: string }[] = [];

  // L1: 核心记忆（MEMORY.md + USER.md），每次对话都注入
  const l1 = await loadL1Memory();
  if (l1.memory.trim()) {
    context.push({ role: 'system', content: `### 项目记忆 (MEMORY.md)\n${l1.memory}`, source: 'l1-memory' });
  }
  if (l1.user.trim()) {
    context.push({ role: 'system', content: `### 用户信息 (USER.md)\n${l1.user}`, source: 'l1-user' });
  }

  // L2: 全文检索历史消息
  if (currentQuery.trim()) {
    const l2Results = await searchL2(currentQuery, 3);
    if (l2Results.length > 0) {
      const l2Content = l2Results.map((r: any) => `[${r.role}] ${(r.content || '').slice(0, 300)}`).join('\n---\n');
      context.push({ role: 'system', content: `### 历史相关对话\n${l2Content}`, source: 'l2-search' });
    }
  }

  // 最近消息
  const messages = await listMessages(sessionId);
  const recentMessages = messages.slice(-10);
  for (const msg of recentMessages) {
    context.push({ role: msg.role, content: msg.content || '', source: 'session' });
  }

  // L4: 情景记忆（当前会话摘要）
  if (messages.length >= 6) {
    const episodic = await getEpisodicMemory(sessionId, 2);
    if (episodic.length > 0) {
      const epContent = episodic.map((e: any) => `[${e.memoryType}] ${e.content}`).join('\n');
      context.push({ role: 'system', content: `### 会话情景记忆\n${epContent}`, source: 'l4-episodic' });
    }
  }

  // L3: Agent 长期记忆
  if (agentId) {
    const agentL3Results = await searchAgentMemory(agentId, currentQuery, 3);
    if (agentL3Results.length > 0) {
      const l3Content = agentL3Results.map(r => `[${r.memoryType}] ${r.content}`).join('\n');
      context.push({ role: 'system', content: `### Agent 长期记忆\n${l3Content}`, source: 'agent-l3' });
    }
  }

  // L3: 全局长期记忆
  const globalL3Results = await searchL3(currentQuery, 3);
  if (globalL3Results.length > 0) {
    const l3Content = globalL3Results.map(r => `[${r.memoryType}] ${r.content}`).join('\n');
    context.push({ role: 'system', content: `### 全局长期记忆\n${l3Content}`, source: 'global-l3' });
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

export async function triggerNudge(sessionId: string, agentId?: string): Promise<void> {
  try {
    const messages = await listMessages(sessionId);
    if (messages.length < 6) return;

    // 检查是否最近已经执行过 nudge
    const lastNudge = await getDb().query(
      `SELECT created_at FROM episodic_memory WHERE source_session = $1 AND memory_type = 'nudge' ORDER BY created_at DESC LIMIT 1`,
      [sessionId]
    );
    if (lastNudge.rows.length > 0) {
      const lastTime = new Date((lastNudge.rows[0] as any).created_at).getTime();
      if (Date.now() - lastTime < 5 * 60 * 1000) return; // 5分钟内不重复
    }

    // 提取最近6条消息用于分析
    const recentMessages = messages.slice(-6);
    const conversationText = recentMessages
      .map(m => `[${m.role}]: ${(m.content || '').slice(0, 500)}`)
      .join('\n');

    // 尝试用 LLM 提取关键信息
    const facts = await extractFactsWithLLM(conversationText);
    if (facts.length > 0) {
      for (const fact of facts) {
        await addEpisodicMemory(sessionId, fact, 'nudge', 3);
        if (agentId) {
          await addAgentMemory(agentId, fact, 'fact');
        }
      }
    }

    // 记录 nudge 标记
    await addEpisodicMemory(sessionId, `nudge:${Date.now()}`, 'nudge', 1);

    // 合并重复记忆
    if (agentId) {
      await consolidateMemories(agentId);
    }
  } catch (err) {
    console.error('Nudge failed:', err);
  }
}

async function extractFactsWithLLM(conversationText: string): Promise<string[]> {
  try {
    const { chat, getLLMConfig } = await import('./llm-provider');
    const config = getLLMConfig();
    if (!config.apiKey) return [];

    const result = await chat({
      systemPrompt: `你是一个信息提取助手。从对话中提取用户的关键信息，以 JSON 数组格式返回。每个元素是一条事实，格式：{"fact": "事实内容", "type": "fact|preference|instruction"}。

提取规则：
- 用户个人信息（姓名、年龄、职业、地点等）
- 用户偏好（喜欢、不喜欢、习惯等）
- 用户指令（要求记住的重要事项）
- 只提取确定性高的事实，不要猜测
- 如果没有可提取的事实，返回空数组 []

请只返回 JSON 数组，不要包含其他文字。`,
      messages: [{ role: 'user', content: conversationText }],
      model: config.model || 'gpt-4o-mini',
      temperature: 0.1
    });

    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const items = JSON.parse(jsonMatch[0]);
    return items.map((i: any) => `[${i.type}] ${i.fact}`);
  } catch {
    return [];
  }
}

// ---- Vector Embedding Support ----

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const { getLLMConfig } = await import('./llm-provider');
    const config = getLLMConfig();
    if (!config.apiKey || !config.baseUrl) return null;

    const resp = await fetch(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model || 'text-embedding-ada-002', input: text })
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    return data?.data?.[0]?.embedding || null;
  } catch { return null; }
}

export async function saveMemoryWithVector(content: string, memoryType: string = 'fact', agentId?: string, sourceSession?: string): Promise<string> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getDb().query(
    'INSERT INTO long_term_memory (id, content, memory_type, agent_id, source_session, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, content, memoryType, agentId || null, sourceSession || null, now]
  );
  generateEmbedding(content).then(emb => {
    if (emb && emb.length === 1536) {
      getDb().query('INSERT INTO memory_vectors (memory_id, embedding) VALUES ($1, $2::real[]) ON CONFLICT (memory_id) DO UPDATE SET embedding = $2::real[]',
        [id, JSON.stringify(emb)]).catch(() => {});
    }
  }).catch(() => {});
  return id;
}

export async function vectorSearchMemory(query: string, agentId?: string, limit: number = 5): Promise<MemoryItem[]> {
  try {
    const emb = await generateEmbedding(query);
    if (!emb || emb.length !== 1536) {
      return searchAgentMemory(agentId || '', query, limit);
    }
    const embJson = JSON.stringify(emb);
    let sql = `SELECT m.id, m.content, m.memory_type as "memoryType", m.importance,
                      m.access_count as "accessCount", m.created_at as "createdAt"
               FROM long_term_memory m
               INNER JOIN memory_vectors v ON v.memory_id = m.id
               WHERE m.is_active = 1`;
    const params: any[] = [embJson];
    if (agentId) {
      sql += ' AND m.agent_id = $2';
      params.push(agentId);
    }
    sql += ' ORDER BY v.embedding <=> $1::real[] LIMIT $' + (params.length + 1);
    params.push(limit);
    const result = await getDb().query<MemoryItem>(sql, params);
    return result.rows;
  } catch {
    return searchAgentMemory(agentId || '', query, limit);
  }
}

export async function addAgentMemoryWithVector(agentId: string, content: string, memoryType: string = 'fact'): Promise<string> {
  return saveMemoryWithVector(content, memoryType, agentId);
}

