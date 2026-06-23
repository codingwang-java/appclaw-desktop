# AppClaw Skill 系统实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task-by-task.

**Goal:** 实现 AppClaw Skill 系统，支持声明式/代码 Skill、/命令触发、Marketplace 下载

**Architecture:** Skill 存储在 `~/.appclaw/skills/`，每个 Skill 一个目录。声明式 Skill 只需 SKILL.md，代码 Skill 有 index.js。执行时通过 skill-manager 加载并注入 Agent 上下文或直接执行 JS。

**Tech Stack:** Electron IPC + React + Node.js sandbox (for code skills) + JSZip (for import/export)

---

## Task 1: 类型定义 + Skill Manager 核心

**Files:**
- Create: `electron/services/skill-manager.ts`
- Modify: `src/shared/types.ts`

**Step 1: 添加 Skill 类型定义到 types.ts**

```typescript
// src/shared/types.ts 新增
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
```

**Step 2: 创建 skill-manager.ts**

```typescript
// electron/services/skill-manager.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { vm } from 'node:vm';

const SKILLS_DIR = path.join(os.homedir(), '.appclaw', 'skills');

export interface ParsedSkill {
  meta: {
    name: string;
    description: string;
    trigger: string;
    tools: string[];
    parameters: any[];
  };
  prompt: string;  // SKILL.md 正文
  type: 'declarative' | 'code';
}

export function getSkillsDir(): string {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }
  return SKILLS_DIR;
}

export function parseSKILLMarkdown(skillPath: string): ParsedSkill | null {
  const mdPath = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;

  const content = fs.readFileSync(mdPath, 'utf-8');
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const [, yamlStr, prompt] = frontmatterMatch;
  const meta: any = {};
  for (const line of yamlStr.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length > 0) {
      const value = rest.join(':').trim();
      if (value === '[]' || value === '-') {
        meta[key.trim()] = [];
      } else if (value.startsWith('[')) {
        meta[key.trim()] = value.slice(1, -1).split(',').map(s => s.trim());
      } else {
        meta[key.trim()] = value.replace(/^['"]|['"]$/g, '');
      }
    }
  }

  const hasCode = fs.existsSync(path.join(skillPath, 'index.js'));

  return {
    meta: {
      name: meta.name || '',
      description: meta.description || '',
      trigger: meta.trigger || path.basename(skillPath),
      tools: meta.tools || [],
      parameters: meta.parameters || [],
    },
    prompt: prompt.trim(),
    type: hasCode ? 'code' : 'declarative',
  };
}

export function listSkills(): SkillInfo[] {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) return [];

  const skills: SkillInfo[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const skillPath = path.join(dir, entry);
    const stat = fs.statSync(skillPath);
    if (!stat.isDirectory()) continue;

    const parsed = parseSKILLMarkdown(skillPath);
    if (!parsed) continue;

    skills.push({
      id: entry,
      name: parsed.meta.name,
      description: parsed.meta.description,
      trigger: parsed.meta.trigger,
      type: parsed.type,
      tools: parsed.meta.tools,
      parameters: parsed.meta.parameters,
      enabled: true,
      source: 'local',
      installedAt: new Date(stat.mtime).toISOString(),
    });
  }
  return skills;
}

export async function executeSkill(skillId: string, params: Record<string, string>): Promise<SkillExecutionResult> {
  const skillPath = path.join(getSkillsDir(), skillId);
  if (!fs.existsSync(skillPath)) {
    return { success: false, error: `Skill "${skillId}" not found` };
  }

  const parsed = parseSKILLMarkdown(skillPath);
  if (!parsed) {
    return { success: false, error: `Invalid SKILL.md` };
  }

  if (parsed.type === 'code') {
    const indexPath = path.join(skillPath, 'index.js');
    try {
      const code = fs.readFileSync(indexPath, 'utf-8');
      const module = { exports: {} };
      const sandbox = {
        module,
        exports: module.exports,
        require: (m: string) => {
          if (m === 'node:vm') return { script: (c: string) => ({ runInNewContext: (ctx: any) => eval(c) }) };
          if (m === 'node:fs') return fs;
          if (m === 'node:path') return path;
          return {};
        },
        console,
        fetch,
        params,
        result: null as any,
      };
      const script = new (require('node:vm').Script)(code);
      script.runInNewContext(sandbox);
      const skillFn = sandbox.module.exports;
      if (typeof skillFn === 'function') {
        const output = await skillFn(params, {});
        return { success: true, output: typeof output === 'string' ? output : JSON.stringify(output) };
      }
      if (skillFn.execute) {
        const output = await skillFn.execute(params, {});
        return { success: true, output: typeof output === 'string' ? output : JSON.stringify(output) };
      }
      return { success: false, error: 'index.js must export execute(params, context) function' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  // 声明式 Skill，返回 prompt 让 Agent 执行
  return { success: true, output: `DECLARATIVE:${parsed.prompt}` };
}

export function createSkillDir(skillId: string): string {
  const skillPath = path.join(getSkillsDir(), skillId);
  fs.mkdirSync(skillPath, { recursive: true });
  return skillPath;
}

export function saveSkillFiles(skillId: string, files: Record<string, string>): void {
  const skillPath = path.join(getSkillsDir(), skillId);
  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(skillPath, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

export function deleteSkill(skillId: string): void {
  const skillPath = path.join(getSkillsDir(), skillId);
  if (fs.existsSync(skillPath)) {
    fs.rmSync(skillPath, { recursive: true, force: true });
  }
}

export function parseTriggerCommand(input: string): { trigger: string; args: string } | null {
  const match = input.trim().match(/^\/(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  return { trigger: match[1], args: match[2] || '' };
}
```

**Step 3: 注册 IPC handlers**

在 `electron/ipc-handlers.ts` 添加：
```typescript
import { listSkills, executeSkill, deleteSkill, saveSkillFiles, createSkillDir, parseTriggerCommand, getSkillsDir } from './services/skill-manager';

ipcMain.handle('skill:list', async () => listSkills());
ipcMain.handle('skill:execute', async (_e, skillId: string, params: Record<string, string>) => executeSkill(skillId, params));
ipcMain.handle('skill:delete', async (_e, skillId: string) => { deleteSkill(skillId); return true; });
ipcMain.handle('skill:save', async (_e, skillId: string, files: Record<string, string>) => { saveSkillFiles(skillId, files); return true; });
ipcMain.handle('skill:create', async (_e, skillId: string) => createSkillDir(skillId));
ipcMain.handle('skill:parse-trigger', async (_e, input: string) => parseTriggerCommand(input));
```

**Step 4: Commit**

```bash
git add electron/services/skill-manager.ts src/shared/types.ts electron/ipc-handlers.ts
git commit -m "feat: add skill-manager core - list, execute, parse trigger commands"
```

---

## Task 2: 前端 Skill API 类型 + /命令解析

**Files:**
- Modify: `src/vite-env.d.ts`
- Modify: `src/App.tsx`

**Step 1: 添加 Skill API 类型到 vite-env.d.ts**

```typescript
// window.api.skills
interface SkillInfo {
  id: string; name: string; description: string; trigger: string;
  type: 'declarative' | 'code'; tools: string[]; parameters: any[];
  enabled: boolean; source: string; installedAt: string;
}
interface SkillExecutionResult { success: boolean; output?: string; error?: string; }

window.api.skills = {
  list: () => Promise<SkillInfo[]>,
  execute: (skillId: string, params: Record<string, string>) => Promise<SkillExecutionResult>,
  delete: (skillId: string) => Promise<boolean>,
  save: (skillId: string, files: Record<string, string>) => Promise<boolean>,
  create: (skillId: string) => Promise<string>,
  parseTrigger: (input: string) => Promise<{ trigger: string; args: string } | null>,
};
```

**Step 2: 修改 App.tsx 的 handleSend 函数，检测 /命令**

在 `handleSend` 函数开头添加：
```typescript
// 检测 /命令
const trimmed = inputText.trim();
if (trimmed.startsWith('/')) {
  const parsed = await window.api.skills?.parseTrigger(trimmed);
  if (parsed) {
    // 查找对应 skill 并执行
    const skills = await window.api.skills?.list() || [];
    const skill = skills.find(s => s.trigger === parsed.trigger);
    if (skill) {
      const params: Record<string, string> = {};
      if (parsed.args) {
        // 简单解析：/skill arg1 arg2 -> 按顺序填参数
        const args = parsed.args.split(/\s+/);
        skill.parameters.forEach((p: any, i: number) => {
          params[p.name] = args[i] || p.default || '';
        });
      }
      const result = await window.api.skills?.execute(skill.id, params);
      if (result?.success && result.output?.startsWith('DECLARATIVE:')) {
        // 声明式 Skill，将 prompt 转为用户消息触发对话
        const prompt = result.output.replace('DECLARATIVE:', '');
        setInputText(prompt);
        return;
      } else if (result?.success) {
        // 代码 Skill，直接显示结果
        setMessages(prev => [...prev, {
          id: 's_' + Date.now(), sessionId: activeSessionId, role: 'assistant',
          content: result.output || '执行完成', createdAt: new Date().toISOString()
        }]);
        return;
      } else {
        setMessages(prev => [...prev, {
          id: 's_' + Date.now(), sessionId: activeSessionId, role: 'assistant',
          content: `Skill 执行失败: ${result?.error}`, createdAt: new Date().toISOString()
        }]);
        return;
      }
    }
  }
}
```

**Step 3: Commit**

```bash
git add src/vite-env.d.ts src/App.tsx
git commit -m "feat: add /command parsing and skill trigger in chat input"
```

---

## Task 3: Skill 设置页 UI

**Files:**
- Modify: `src/App.tsx` (添加 Skill 管理 UI)
- Modify: `src/styles.css`

**Step 1: 在设置页添加 Skill 管理区域**

在 `src/App.tsx` 的 settings 视图中添加：

```tsx
{/* Skill 管理 */}
<div className="card">
  <h3>技能管理</h3>
  <div className="skill-list">
    {skills.map(skill => (
      <div key={skill.id} className="skill-item">
        <div className="skill-info">
          <div className="skill-name">{skill.name}</div>
          <div className="skill-desc">{skill.description}</div>
          <div className="skill-trigger">/{skill.trigger}</div>
        </div>
        <button className="skill-del" onClick={() => handleDeleteSkill(skill.id)}>删除</button>
      </div>
    ))}
    {skills.length === 0 && <div className="empty-hint">暂无已安装的技能</div>}
  </div>
  <div className="btn-row">
    <button className="btn-primary" onClick={handleCreateSkill}>创建技能</button>
  </div>
</div>
```

添加 state: `const [skills, setSkills] = useState<SkillInfo[]>([]);`
添加函数:
```typescript
async function loadSkills() {
  const list = await window.api.skills?.list() || [];
  setSkills(list);
}
useEffect(() => { loadSkills(); }, []);
async function handleDeleteSkill(id: string) {
  if (!confirm('确定删除这个技能？')) return;
  await window.api.skills?.delete(id);
  await loadSkills();
}
```

**Step 2: 添加样式到 styles.css**

```css
.skill-list { display: flex; flex-direction: column; gap: 8px; }
.skill-item { display: flex; align-items: center; justify-content: space-between;
  padding: 12px; background: var(--bg-tertiary); border-radius: var(--radius-sm); }
.skill-name { font-weight: 600; color: var(--text-primary); }
.skill-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.skill-trigger { font-size: 12px; color: var(--accent); margin-top: 4px; }
.skill-del { color: var(--red); font-size: 12px; }
```

**Step 3: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: add skill management UI in settings page"
```

---

## Task 4: Skill 导入导出 (ZIP)

**Files:**
- Modify: `electron/services/skill-manager.ts`
- Modify: `electron/ipc-handlers.ts`
- Modify: `src/App.tsx`

**Step 1: 添加 JSZip 依赖**

先安装 jszip: `npm install jszip @types/jszip --save`

**Step 2: 在 skill-manager.ts 添加导入导出函数**

```typescript
import JSZip from 'jszip';

export async function exportSkillZip(skillId: string): Promise<Buffer> {
  const skillPath = path.join(getSkillsDir(), skillId);
  const zip = new JSZip();
  const addDir = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        addDir(fullPath, `${prefix}${entry}/`);
      } else {
        zip.file(`${prefix}${entry}`, fs.readFileSync(fullPath));
      }
    }
  };
  addDir(skillPath, '');
  return zip.generateAsync({ type: 'nodebuffer' });
}

export async function importSkillZip(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  // 找 SKILL.md 确定 skill id
  const skillMd = await zip.file('SKILL.md')?.async('string');
  if (!skillMd) throw new Error('Invalid skill package: missing SKILL.md');

  // 从 frontmatter 解析 trigger 作为 id
  const triggerMatch = skillMd.match(/^---\n[\s\S]*?trigger:\s*(\w+)[\s\S]*?\n---/);
  const trigger = triggerMatch?.[1] || `skill-${Date.now()}`;
  const skillPath = path.join(getSkillsDir(), trigger);
  fs.mkdirSync(skillPath, { recursive: true });

  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const filePath = path.join(skillPath, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, await file.async('nodebuffer'));
  }
  return trigger;
}
```

**Step 2: 注册 IPC**

```typescript
ipcMain.handle('skill:export', async (_e, skillId: string) => {
  const buf = await exportSkillZip(skillId);
  return buf.toString('base64');
});
ipcMain.handle('skill:import', async (_e, base64: string) => {
  const buf = Buffer.from(base64, 'base64');
  return importSkillZip(buf);
});
```

**Step 3: 前端添加导入导出按钮**

在 Skill 管理页添加"导入"和"导出"按钮，导出生成下载，导入用 file input 选择 .zip。

**Step 4: Commit**

```bash
git add electron/services/skill-manager.ts electron/ipc-handlers.ts src/App.tsx
git commit -m "feat: add skill import/export with ZIP format"
```

---

## Task 5: 创建 Skill UI

**Files:**
- Modify: `src/App.tsx`

在 Skill 管理页添加"创建技能"弹窗，包含表单：
- 名称、触发词、描述
- 工具选择（复选框）
- 参数定义（动态添加/删除）
- SKILL.md 预览

保存时生成 SKILL.md 文件。

**Commit:**
```bash
git add src/App.tsx
git commit -m "feat: add skill creation UI with form"
```

---

## Task 6: 构建、测试、打包

**Step 1: 构建**
```bash
node node_modules/vite/bin/vite.js build
```

**Step 2: 测试 /命令触发**
- 启动应用，进入设置，创建一个测试 Skill
- 在聊天框输入 `/trigger arg` 测试

**Step 3: 打包**
```bash
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; node node_modules\electron-builder\out\cli\cli.js --win --publish never
```

**Step 4: 推送并打 tag**
```bash
git push origin main
git tag v0.3.0
git push origin v0.3.0
```
