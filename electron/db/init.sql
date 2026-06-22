CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  system_prompt TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.7,
  tools TEXT NOT NULL DEFAULT '[]',
  tool_permissions TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  last_accessed TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool_name TEXT NOT NULL,
  arguments TEXT,
  result_preview TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  user_approved INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value TEXT,
  category TEXT,
  confidence REAL DEFAULT 1.0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_type ON long_term_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_active ON long_term_memory(is_active);
CREATE INDEX IF NOT EXISTS idx_tools_session ON tool_executions(session_id);

INSERT OR IGNORE INTO agents (id, name, model, system_prompt, temperature, tools, tool_permissions)
VALUES (
  'default-agent',
  '默认助手',
  'gpt-4o-mini',
  '你是 AppClaw，一个强大的桌面 AI 助手。你可以通过工具调用操作系统程序、浏览器、文件系统等。请用中文回复，回答简洁专业。当用户请求超出对话范围的操作时，使用相应的工具来完成任务。对于涉及修改、发送、执行的操作，始终确保用户已经确认。',
  0.7,
  '["filesystem", "browser", "shell", "memory"]',
  '{"fs_write_file": {"requireConfirm": true}, "shell_exec": {"requireConfirm": true}, "email_send": {"requireConfirm": true}}'
);

INSERT OR IGNORE INTO sessions (id, agent_id, title, created_at, updated_at)
VALUES ('welcome-session', 'default-agent', '欢迎会话', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at)
VALUES (
  'welcome-msg',
  'welcome-session',
  'assistant',
  '你好！我是 AppClaw 桌面助手 👋\n\n我可以帮你：\n• 进行对话和问答\n• 操作浏览器搜索信息\n• 读写本地文件\n• 执行系统命令\n• 记住重要信息\n\n开始输入你的问题吧！',
  datetime('now')
);

INSERT OR IGNORE INTO user_profile (key, value, category, confidence)
VALUES ('language', 'zh-CN', 'preference', 1.0);
