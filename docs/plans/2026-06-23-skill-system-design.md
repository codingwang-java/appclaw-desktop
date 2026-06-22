# AppClaw Skill 系统设计

## 概述

Skill 是 AppClaw 的可扩展能力模块，用户可以从 Marketplace 下载、本地创建或导入 Skill，通过 `/命令` 或自然语言对话触发执行。

## Skill 类型

| 类型 | 文件 | 说明 |
|------|------|------|
| 声明式 Skill | 仅 `SKILL.md` | 零代码，提示词+工具组合，LLM 按提示词执行 |
| 代码 Skill | `SKILL.md` + `index.js` | 可编程，执行复杂逻辑（API调用、数据处理等） |

## 文件结构

```
~/.appclaw/skills/
├── weather/
│   ├── SKILL.md              # 技能元数据（必需）
│   ├── index.js              # 代码逻辑（代码 Skill 才需要）
│   └── package.json          # 依赖（可选）
├── summarize/
│   └── SKILL.md              # 声明式 Skill
└── gmail/
    ├── SKILL.md
    ├── index.js
    └── package.json
```

## SKILL.md 格式

YAML frontmatter + Markdown 正文：

```yaml
---
name: 天气查询
description: 查询任意城市的实时天气
trigger: weather
tools:
  - browser
parameters:
  - name: city
    label: 城市
    type: text
    required: true
    placeholder: 如：北京
---

当用户使用 /weather 命令时，使用浏览器工具搜索 {city} 的实时天气，
返回温度、湿度、风力等信息。
```

- frontmatter：元数据（名称、触发词、工具、参数定义）
- 正文：系统提示词模板，`{参数名}` 为参数占位符

## 代码 Skill 的 index.js

```javascript
module.exports = {
  async execute(params, context) {
    const { city } = params;
    const resp = await fetch(`https://wttr.in/${city}?format=j1`);
    const data = await resp.json();
    return {
      output: `${city}: ${data.current_condition[0].temp_C}°C`,
    };
  }
};
```

- `params`：用户传入的参数对象
- `context`：运行上下文（logger、tools 等）
- 返回 `{ output: string }` 给 LLM 或直接回复用户

## 触发机制

1. **`/命令` 触发**：用户输入 `/weather 北京`，解析出 Skill trigger + 参数
2. **对话自动匹配**：用户说"帮我查北京天气"，LLM 根据已安装 Skill 的描述自动选择

## 执行流程

```
用户输入 → 前端解析(/命令 or 自然语言)
  → IPC 到主进程 skill-manager
  → 加载 Skill (SKILL.md + index.js)
  → 声明式: 提示词+参数注入 Agent 上下文 → LLM 执行
  → 代码式: 调用 execute() → 返回结果
  → 结果回传前端展示
```

## Skill Marketplace

- 设置页内置 ClawHub 浏览器，搜索、预览、一键安装
- 安装 = 下载 ZIP 解压到 `~/.appclaw/skills/`
- 支持从本地 ZIP 导入
- 支持导出 Skill 为 ZIP 分享

## 后端架构

新增文件：
- `electron/services/skill-manager.ts`：Skill 加载、注册、解析、执行
- IPC handlers：`skill:list`, `skill:get`, `skill:create`, `skill:delete`, `skill:execute`, `skill:import`, `skill:export`

修改文件：
- `electron/ipc-handlers.ts`：注册 skill 相关 IPC
- `src/shared/types.ts`：新增 Skill 类型定义
- `src/App.tsx`：/ 命令解析 + Skill 设置页 + Skill 列表
- `src/styles.css`：Skill 相关样式
- `electron/preload.ts`：暴露 skill API

## 数据模型

```typescript
interface SkillMeta {
  name: string;
  description: string;
  trigger: string;
  tools: string[];
  parameters: SkillParameter[];
}

interface SkillParameter {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select';
  required: boolean;
  default?: string;
  options?: string[];
  placeholder?: string;
}

interface SkillInfo {
  id: string;                    // 目录名，即 trigger
  name: string;
  description: string;
  trigger: string;
  type: 'declarative' | 'code';  // 声明式 or 代码
  tools: string[];
  parameters: SkillParameter[];
  enabled: boolean;
  source: 'local' | 'marketplace' | 'import';
  installedAt: string;
}
```

## 实现任务

1. 类型定义 + skill-manager 核心逻辑
2. SKILL.md 解析器（YAML frontmatter）
3. 声明式 Skill 执行（注入 Agent 上下文）
4. 代码 Skill 执行（sandbox 调用 index.js）
5. 前端 / 命令解析 + Skill 触发
6. Skill 设置页（列表、创建、编辑、删除）
7. Skill 导入导出（ZIP）
8. ClawHub Marketplace 浏览器
