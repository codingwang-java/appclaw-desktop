# Agent Memory 系统实现计划

## 一、任务拆分

### Task 1: 数据库表结构扩展
- 添加 FTS5 全文索引表
- 添加 episodic_memory 情景记忆表
- 添加 skill_memory 技能统计表
- 创建触发器自动维护 FTS 索引

### Task 2: Memory Service 核心实现
- 实现 L1 提示记忆（文件读写）
- 实现 L2 FTS5 检索
- 实现 L3 情景记忆 CRUD
- 实现 L4 技能统计更新

### Task 3: Context 构建逻辑
- 修改 `buildContextMessages()` 函数
- 按优先级组合各层记忆
- 实现 token 计数和截断

### Task 4: Nudge 机制实现
- 实现 Nudge 触发检测
- 实现记忆提取逻辑
- 实现 Consolidate 优化

### Task 5: API 接口注册
- 注册记忆相关的 IPC handlers
- 前端调用接口封装

### Task 6: 测试验证
- 构建测试
- 打包验证

## 二、详细步骤

### Task 1: 数据库表结构扩展

**文件**: `electron/services/memory-service.ts`

**步骤**:
1. 在 INIT_SQL 中添加新表定义
2. 添加 FTS5 虚拟表和触发器
3. 添加 episodic_memory 表
4. 添加 skill_memory 表

### Task 2: Memory Service 核心实现

**文件**: `electron/services/memory-service.ts`

**新增方法**:
1. `initMemorySystem()` - 初始化记忆目录
2. `loadL1Memory()` - 加载 MEMORY.md 和 USER.md
3. `saveL1Memory(data)` - 保存 L1 记忆
4. `searchL2(query, limit)` - FTS5 检索
5. `addL3Memory(content, type, sessionId)` - 添加情景记忆


6. `searchL3(query, limit)` - 检索情景记忆
7. `updateSkillStats(skillId, success)` - 更新技能统计

### Task 3: Context 构建逻辑

**文件**: `electron/services/memory-service.ts`

**修改**:
1. 修改 `buildContextMessages()` 函数
2. 按顺序加载各层记忆
3. 添加 token 计数和截断逻辑

### Task 4: Nudge 机制实现

**文件**: `electron/services/memory-service.ts`

**新增方法**:
1. `triggerNudge(sessionId)` - 触发 Nudge
2. `extractMemoryFromMessages(messages)` - 提取值得记忆的内容
3. `consolidateMemory()` - 合并优化记忆

### Task 5: API 接口注册

**文件**: `electron/ipc-handlers.ts`

**新增 IPC handlers**:
1. `memory:l1:get` - 获取 L1 记忆
2. `memory:l1:save` - 保存 L1 记忆
3. `memory:l2:search` - L2 检索
4. `memory:l3:add` - 添加 L3 记忆
5. `memory:l3:search` - L3 检索

### Task 6: 测试验证

**步骤**:
1. 运行 `vite build` 验证构建
2. 运行 `electron-builder` 打包验证
3. 手动测试记忆功能

## 三、时间预估

| 任务 | 预估时间 | 优先级 |
|------|---------|-------|
| Task 1: 数据库扩展 | 2 小时 | 高 |
| Task 2: Memory Service | 4 小时 | 高 |
| Task 3: Context 构建 | 3 小时 | 高 |
| Task 4: Nudge 机制 | 3 小时 | 中 |
| Task 5: API 注册 | 1 小时 | 中 |
| Task 6: 测试验证 | 2 小时 | 高 |
| **总计** | **15 小时** | |

## 四、依赖关系

```
Task 1 ──→ Task 2 ──→ Task 3 ──→ Task 4
                              ──→ Task 5
                                        ──→ Task 6
```

## 五、输出物

1. `electron/services/memory-service.ts` - 完整的记忆服务实现
2. `electron/ipc-handlers.ts` - 更新的 IPC handlers
3. `src/vite-env.d.ts` - 更新的类型定义
4. `docs/plans/2026-06-23-memory-system-design.md` - 设计文档（已创建）