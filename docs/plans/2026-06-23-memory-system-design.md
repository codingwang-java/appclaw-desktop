# Agent Memory 系统设计文档

## 一、设计目标

基于 Hermes Agent 四层架构，为 AppClaw 实现完整的记忆系统，包括：

1. **L1 提示记忆层** - 轻量文件存储，快速加载关键信息
2. **L2 会话检索层** - FTS5 全文索引，支持历史对话检索
3. **L3 情景记忆层** - 跨会话事实存储，支持用户建模
4. **L4 技能记忆层** - 技能使用统计，优化技能推荐

## 二、架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    AppClaw Agent Memory                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                │
│  L1 提示记忆层 (文件)                                           │
│  ├── MEMORY.md (~800 tokens)                                   │
│  └── USER.md (~500 tokens)                                     │
│                          ↓                                      │
│  L2 会话检索层 (PGlite FTS5)                                    │
│  └── messages_fts (全文索引)                                    │
│                          ↓                                      │
│  L3 情景记忆层 (PGlite)                                         │
│  ├── episodic_memory (跨会话事实)                                │
│  └── user_profile (用户画像)                                    │
│                          ↓                                      │
│  L4 技能记忆层 (文件 + PGlite)                                   │
│  ├── skills/*.md (技能定义)                                     │
│  └── skill_memory (使用统计)                                    │
│                                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 各层详细设计

#### L1 提示记忆层

| 文件 | 存储内容 | 容量限制 | 刷新策略 |
|------|---------|---------|---------|
| MEMORY.md | 环境事实、项目约定、踩坑经验 | ~800 tokens | 延迟生效 |
| USER.md | 用户偏好、沟通风格、关键个人信息 | ~500 tokens | 延迟生效 |

**延迟生效策略**：会话中的修改不立即写入文件，等到对话结束后批量写入，避免破坏 LLM 的 prefix cache。

#### L2 会话检索层

| 表名 | 类型 | 用途 |
|------|------|------|
| messages_fts | FTS5 虚拟表 | 全文索引历史对话 |

**检索策略**：每次对话自动执行 FTS5 搜索，匹配当前 query，最多返回 3 条相关片段。

#### L3 情景记忆层

**episodic_memory 表结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 主键 |
| content | TEXT | 记忆内容 |
| memory_type | TEXT | 记忆类型 (fact/preference/skill/observation) |
| importance | INTEGER | 重要性 (1-5) |
| source_session | TEXT | 来源会话 ID |
| access_count | INTEGER | 访问次数 |
| last_accessed | TIMESTAMPTZ | 最后访问时间 |
| is_active | SMALLINT | 是否激活 |
| created_at | TIMESTAMPTZ | 创建时间 |

**user_profile 表扩展**：

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 键 |
| value | TEXT | 值 |
| category | TEXT | 类别 (preference/identity/history) |
| confidence | REAL | 置信度 (0-1) |
| is_active | SMALLINT | 是否激活 |
| created_at | TIMESTAMPTZ | 创建时间 |

#### L4 技能记忆层

**skill_memory 表结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| skill_id | TEXT | 技能 ID |
| use_count | INTEGER | 使用次数 |
| success_count | INTEGER | 成功次数 |
| last_used | TIMESTAMPTZ | 最后使用时间 |
| last_success | TIMESTAMPTZ | 最后成功时间 |

### 2.3 Nudge 机制

**触发时机**：
- 每 10 个 tool_call turn
- 对话结束时（用户主动结束或空闲超时）

**Nudge 流程**：

```
┌─────────────────────────────────────────────┐
│              Nudge 触发                      │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  1. Read: 扫描当前会话新增消息               │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  2. Write: 判断值得记忆的内容                │
│     - 用户纠正、关键成功/失败                │
│     - 偏好变化、环境配置                    │
│     - 重复模式、可沉淀技能                   │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  3. Manage: Consolidate 优化               │
│     - 合并相似条目                          │
│     - 删除过时/低价值内容                    │
│     - 维持容量上限                          │
└─────────────────────────────────────────────┘
```

### 2.4 Context 构建顺序

每轮对话按以下优先级构建 context（低优先级内容可能被截断）：

1. **System Prompt** (来自 agent 配置)
2. **L1 提示记忆** (MEMORY.md + USER.md)
3. **L4 技能记忆** (按触发命令匹配)
4. **L2 会话检索** (FTS5 相关历史)
5. **L3 情景记忆** (按 memory_type 匹配)
6. **当前会话消息** (最近 20 条)

## 三、数据流设计

### 3.1 写入流程

```
用户输入 → 消息保存 → Nudge 检测 → 记忆提取 → 分层存储
                          ↓
                   ┌──────┴──────┐
                   ↓             ↓
              L1 文件更新    L3/L4 数据库写入
```

### 3.2 读取流程

```
新对话开始 → Context 构建 → LLM 调用
              ↓
    ┌───┬───┬───┬───┬───┬───┐
    ↓   ↓   ↓   ↓   ↓   ↓   ↓
   Sys L1  L4  L2  L3  当前会话
```

## 四、API 设计

### 4.1 Memory Service API

| 方法 | 功能 | 参数 | 返回值 |
|------|------|------|--------|
| `initMemorySystem()` | 初始化记忆系统 | 无 | void |
| `loadL1Memory()` | 加载 L1 提示记忆 | 无 | { memory: string; user: string } |
| `saveL1Memory(data)` | 保存 L1 记忆 | { memory: string; user: string } | boolean |
| `searchL2(query, limit)` | 检索 L2 会话 | query: string, limit: number | MemoryItem[] |
| `addL3Memory(content, type)` | 添加 L3 情景记忆 | content: string, type: string | string (id) |
| `searchL3(query, limit)` | 检索 L3 记忆 | query: string, limit: number | MemoryItem[] |
| `updateSkillStats(skillId, success)` | 更新技能统计 | skillId: string, success: boolean | void |
| `buildContext(sessionId, query)` | 构建完整 context | sessionId: string, query: string | Message[] |
| `triggerNudge(sessionId)` | 触发 Nudge | sessionId: string | void |

### 4.2 Context 消息格式

```typescript
interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  source?: 'system' | 'l1' | 'l2' | 'l3' | 'l4' | 'session';
}
```

## 五、数据库变更

### 5.1 新增表 SQL

```sql
-- L2 FTS5 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  created_at UNINDEXED,
  tokenize='porter'
);

-- L3 情景记忆
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

-- L4 技能统计
CREATE TABLE IF NOT EXISTS skill_memory (
  skill_id TEXT PRIMARY KEY,
  use_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,
  last_success TIMESTAMPTZ
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_episodic_active ON episodic_memory(is_active);
CREATE INDEX IF NOT EXISTS idx_episodic_importance ON episodic_memory(importance);
```

### 5.2 FTS5 触发器

```sql
-- 消息写入时自动更新 FTS 索引
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages
BEGIN
  INSERT INTO messages_fts(rowid, content, session_id, created_at)
  VALUES (new.rowid, new.content, new.session_id, new.created_at);
END;

-- 消息更新时自动更新 FTS 索引
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
BEGIN
  UPDATE messages_fts SET content = new.content WHERE rowid = old.rowid;
END;

-- 消息删除时自动删除 FTS 索引
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages
BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
```

## 六、安全性考虑

1. **容量限制**：L1 严格限制在 1300 tokens，防止记忆膨胀
2. **去重机制**：Nudge 时自动合并相似条目
3. **权限控制**：仅允许修改自己的记忆
4. **本地存储**：所有数据保存在用户本地，不上传云端
5. **隐私保护**：敏感信息（如 API Key）不存入记忆系统

## 七、性能优化

1. **延迟生效**：L1 修改延迟写入，避免频繁 IO
2. **索引优化**：FTS5 + 复合索引加速检索
3. **滑动窗口**：当前会话只保留最近 20 条消息
4. **渐进加载**：L4 技能按需加载，分三级加载策略

## 八、扩展能力

1. **多语言支持**：通过 USER.md 的 language 字段支持多语言
2. **技能推荐**：基于 skill_memory 统计自动推荐常用技能
3. **记忆迁移**：支持导出/导入记忆数据
4. **智能压缩**：自动识别冗余内容并合并