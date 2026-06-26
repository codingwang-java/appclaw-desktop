import { ipcMain, BrowserWindow } from 'electron';
import {
  listSessions,
  createSession,
  deleteSession,
  listMessages,
  searchMemory,
  addMemory,
  loadL1Memory,
  saveL1Memory,
  searchL2,
  addL3Memory,
  searchL3,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentSkills,
  addAgentSkill,
  removeAgentSkill,
  toggleAgentSkill,
  searchAgentMemory,
  addAgentMemory
} from './services/memory-service';
import {
  getWorkspace,
  listWorkspaces,
  saveWorkspace,
  getCurrentLLMConfig,
  saveLLMConfig
} from './services/workspace-manager';
import { sendChatMessage, resolveToolConfirmation, applyLLMConfig } from './services/agent-orchestrator';
import { listServers } from './services/mcp-manager';
import { checkForUpdates, downloadUpdate, quitAndInstall } from './services/update-service';
import { listSkills, executeSkill, deleteSkill, createSkill, saveSkill, getSkillSystemPrompt, skillExists } from './services/skill-manager';
import type { ChatSendPayload, LLMConfig, WorkspaceConfig } from '../src/shared/types';

export function registerIpcHandlers() {
  // 窗口控制
  ipcMain.handle('window:minimize', async () => { BrowserWindow.getFocusedWindow()?.minimize(); });
  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
  });
  ipcMain.handle('window:close', async () => { BrowserWindow.getFocusedWindow()?.close(); });
  ipcMain.handle('window:isMaximized', async () => BrowserWindow.getFocusedWindow()?.isMaximized() ?? false);

  ipcMain.handle('workspace:list', async () => listWorkspaces());
  ipcMain.handle('workspace:get', async () => getWorkspace());
  ipcMain.handle('workspace:save', async (_e, cfg: WorkspaceConfig) => saveWorkspace(cfg));

  ipcMain.handle('llm:config:get', async () => getCurrentLLMConfig());
  ipcMain.handle('llm:config:save', async (_e, cfg: LLMConfig) => {
    applyLLMConfig(cfg);
    return saveLLMConfig(cfg);
  });

  ipcMain.handle('session:list', async () => listSessions());
  ipcMain.handle('session:create', async (_e, title: string, agentId?: string) => createSession(title, agentId || 'default-agent'));
  ipcMain.handle('session:delete', async (_e, sessionId: string) => deleteSession(sessionId));

  ipcMain.handle('message:list', async (_e, sessionId: string) => listMessages(sessionId));

  ipcMain.handle('agent:list', async () => listAgents());
  ipcMain.handle('agent:get', async (_e, agentId: string) => getAgent(agentId));
  ipcMain.handle('agent:create', async (_e, data: any) => createAgent(data));
  ipcMain.handle('agent:update', async (_e, agentId: string, data: any) => updateAgent(agentId, data));
  ipcMain.handle('agent:delete', async (_e, agentId: string) => deleteAgent(agentId));

  ipcMain.handle('agent:skills:list', async (_e, agentId: string) => getAgentSkills(agentId));
  ipcMain.handle('agent:skills:add', async (_e, agentId: string, skillId: string) => {
    await addAgentSkill(agentId, skillId);
    return true;
  });
  ipcMain.handle('agent:skills:remove', async (_e, agentId: string, skillId: string) => {
    await removeAgentSkill(agentId, skillId);
    return true;
  });
  ipcMain.handle('agent:skills:toggle', async (_e, agentId: string, skillId: string) => toggleAgentSkill(agentId, skillId));

  ipcMain.handle('agent:memory:search', async (_e, { agentId, query, limit }: { agentId: string; query: string; limit?: number }) => {
    return searchAgentMemory(agentId, query, limit || 5);
  });
  ipcMain.handle('agent:memory:add', async (_e, { agentId, content, memoryType }: { agentId: string; content: string; memoryType?: string }) => {
    const id = await addAgentMemory(agentId, content, memoryType || 'fact');
    return !!id;
  });

  ipcMain.handle('chat:send', async (_e, payload: ChatSendPayload) => {
    return sendChatMessage(payload.sessionId, payload.message, payload.agentId || 'default-agent');
  });

  ipcMain.handle('memory:search', async (_e, { query, limit }: { query: string; limit?: number }) => {
    return searchMemory(query, limit || 5);
  });
  ipcMain.handle('memory:add', async (_e, { content, memoryType }: { content: string; memoryType?: string }) => {
    const id = await addMemory(content, memoryType || 'fact');
    return !!id;
  });
  ipcMain.handle('memory:l1:get', async () => loadL1Memory());
  ipcMain.handle('memory:l1:save', async (_e, data: { memory: string; user: string }) => saveL1Memory(data));
  ipcMain.handle('memory:l2:search', async (_e, { query, limit }: { query: string; limit?: number }) => searchL2(query, limit || 3));
  ipcMain.handle('memory:l3:add', async (_e, { content, memoryType, sourceSession }: { content: string; memoryType?: string; sourceSession?: string }) => addL3Memory(content, memoryType || 'fact', sourceSession));
  ipcMain.handle('memory:l3:search', async (_e, { query, limit }: { query: string; limit?: number }) => searchL3(query, limit || 5));

  ipcMain.handle('tool:list', async () => listServers());

  // 自动更新
  ipcMain.handle('update:check', async () => checkForUpdates());
  ipcMain.handle('update:download', async () => { await downloadUpdate(); });
  ipcMain.handle('update:install', async () => quitAndInstall());

  // Skill 管理
  ipcMain.handle('skill:list', async () => listSkills());
  ipcMain.handle('skill:execute', async (_e, skillId: string, params: Record<string, string>) => executeSkill(skillId, params));
  ipcMain.handle('skill:delete', async (_e, skillId: string) => deleteSkill(skillId));
  ipcMain.handle('skill:create', async (_e, skill: any) => createSkill(skill));
  ipcMain.handle('skill:save', async (_e, skillId: string, updates: any) => saveSkill(skillId, updates));
  ipcMain.handle('skill:getPrompt', async (_e, skillId: string) => getSkillSystemPrompt(skillId));
  ipcMain.handle('skill:exists', async (_e, skillId: string) => skillExists(skillId));

  // Skill Marketplace
  // 热门 Skill 排行榜（预置精选，带真实下载源）
  const POPULAR_SKILLS = [
    { id: 'nextlevelbuilder/ui-ux-pro-max-skill', name: 'UI/UX Pro Max', description: '专业 UI/UX 设计，50+ 设计风格、161 色板、57 字体搭配', installs: '12.5K', topic: 'design', rank: 1, skillDir: 'ui-ux-pro-max' },
    { id: 'anthropics/skills/react-development', name: 'React Expert', description: 'React 开发，组件设计、状态管理、性能优化', installs: '9.8K', topic: 'coding', rank: 3 },
    { id: 'anthropics/skills/python-automation', name: 'Python Automation', description: 'Python 脚本自动化，文件处理、数据抓取', installs: '8.5K', topic: 'coding', rank: 4 },
    { id: 'anthropics/skills/data-analysis', name: 'Data Analyst', description: '数据分析与可视化，SQL、图表、报告', installs: '7.9K', topic: 'data', rank: 5 },
    { id: 'anthropics/skills/code-review', name: 'Code Review', description: '代码审查，质量、安全、性能检查', installs: '7.2K', topic: 'coding', rank: 6 },
    { id: 'anthropics/skills/testing-tdd', name: 'TDD & Testing', description: '测试驱动开发，单元/集成/E2E 测试', installs: '6.8K', topic: 'coding', rank: 7 },
    { id: 'anthropics/skills/git-workflow', name: 'Git & Workflow', description: 'Git 工作流，分支策略、CI/CD', installs: '6.5K', topic: 'devops', rank: 8 },
    { id: 'anthropics/skills/database-design', name: 'Database Design', description: '数据库设计，Schema、索引、查询优化', installs: '6.1K', topic: 'data', rank: 9 },
    { id: 'anthropics/skills/api-development', name: 'API Developer', description: 'REST/GraphQL API 设计、开发', installs: '5.1K', topic: 'coding', rank: 12 },
    { id: 'anthropics/skills/security-audit', name: 'Security Audit', description: '安全审计、漏洞扫描、最佳实践', installs: '4.8K', topic: 'devops', rank: 13 },
    { id: 'anthropics/skills/documentation', name: 'Technical Writer', description: '技术文档，README、API 文档、用户指南', installs: '4.5K', topic: 'productivity', rank: 14 },
    { id: 'anthropics/skills/project-manager', name: 'Project Manager', description: '项目管理，任务分解、进度跟踪', installs: '4.2K', topic: 'productivity', rank: 15 },
    { id: 'anthropics/skills/nextjs-dev', name: 'Next.js Developer', description: 'Next.js 全栈，SSR、SSG、App Router', installs: '4.0K', topic: 'coding', rank: 16 },
    { id: 'anthropics/skills/vue-nuxt', name: 'Vue/Nuxt Expert', description: 'Vue 3 / Nuxt 3 开发', installs: '3.8K', topic: 'coding', rank: 17 },
    { id: 'anthropics/skills/mobile-react-native', name: 'React Native Dev', description: 'React Native 跨平台 App', installs: '3.6K', topic: 'coding', rank: 18 },
    { id: 'anthropics/skills/devops-docker', name: 'DevOps & Docker', description: 'Docker、Kubernetes、CI/CD 流水线', installs: '3.4K', topic: 'devops', rank: 19 },
    { id: 'anthropics/skills/writing-editor', name: 'Writing & Editing', description: '文案写作与编辑、润色、校对', installs: '3.2K', topic: 'productivity', rank: 20 },
  ];
  // 可实际安装的 skill（有 skillDir 的可以从 nextlevelbuilder/ui-ux-pro-max-skill 仓库下载）
  const INSTALLABLE_REPOS: Record<string, string> = {
    'nextlevelbuilder/ui-ux-pro-max-skill': 'https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/.claude/skills',
  };

  ipcMain.handle('skill:marketplace:popular', async () => {
    return POPULAR_SKILLS;
  });

  ipcMain.handle('skill:marketplace:search', async (_e, query: string) => {
    try {
      const https = await import('https');
      const url = `https://skills.sh/topic/design`;
      return new Promise((resolve) => {
        https.get(url, { headers: { 'User-Agent': 'AppClaw/1.0' } }, (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => {
            const results: any[] = [];
            const skillRegex = /<a[^>]*href="https:\/\/www\.skills\.sh\/([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<[\s\S]*?<\/a>[\s\S]*?<p[^>]*>([^<]*)<[\s\S]*?<a[^>]*href="https:\/\/www\.skills\.sh\/([^"]+)"[^>]*>[\s\S]*?(\d[\d.]*[KM]?)<\/a>/gi;
            let m: RegExpExecArray | null;
            while ((m = skillRegex.exec(data)) !== null) {
              if (!query || m[2].toLowerCase().includes(query.toLowerCase()) || m[3].toLowerCase().includes(query.toLowerCase())) {
                results.push({ id: m[1], name: m[2], description: m[3], installs: m[5] });
              }
            }
            const allResults = [...POPULAR_SKILLS.filter(p => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase())), ...results];
            const seen = new Set();
            const deduped = allResults.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
            resolve(deduped.slice(0, 30));
          });
        }).on('error', () => {
          const filtered = POPULAR_SKILLS.filter(p => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase()));
          resolve(filtered);
        });
      });
    } catch (e: any) { return POPULAR_SKILLS.filter(p => !query || p.name.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase())); }
  });

  ipcMain.handle('skill:marketplace:install', async (_e, skillId: string, skillName: string, skillDir?: string) => {
    try {
      const https = await import('https');
      const fss = await import('fs');
      const pth = await import('path');
      const os = await import('os');

      // 1. If skill has a known direct install URL, use it
      let rawUrl = '';
      if (skillDir) {
        const repoBase = INSTALLABLE_REPOS[skillId];
        if (repoBase) {
          rawUrl = `${repoBase}/${skillDir}/SKILL.md`;
        }
      }
      if (!rawUrl) {
        const parts = skillId.split('/');
        if (skillId.includes('anthropics/skills') || skillId.includes('vercel-labs/skills')) {
          rawUrl = `https://raw.githubusercontent.com/anthropics/skills/main/skills/${skillName}/SKILL.md`;
        } else if (skillId.includes('vercel-labs/agent-skills')) {
          rawUrl = `https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/${skillName}/SKILL.md`;
        } else if (skillId.includes('pbakaus/impeccable')) {
          rawUrl = `https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/${skillName}.md`;
        } else if (skillId.includes('nextlevelbuilder/ui-ux-pro-max-skill')) {
          rawUrl = `https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/.claude/skills/${skillName}/SKILL.md`;
        } else if (parts.length >= 2) {
          const githubPath = skillId.replace('www.skills.sh/', '').replace('skills.sh/', '');
          const repoParts = githubPath.split('/skills/')[0];
          if (repoParts) {
            const [owner, repo] = repoParts.split('/');
            rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${skillName}/SKILL.md`;
          }
        }
      }
      if (!rawUrl) return { success: false, error: 'Unknown skill repository format' };
      // Use skillDir as directory name (sanitized), not skillName which may contain slashes
      const dirName = (skillDir || skillName).replace(/[\/\\:*?"<>|]/g, '-').trim();
      const targetDir = pth.join(os.homedir(), '.appclaw', 'skills', dirName);
      if (fss.existsSync(pth.join(targetDir, 'SKILL.md'))) return { success: false, error: 'Skill already installed', dirName };
      return new Promise((resolve) => {
        https.get(rawUrl, (res: any) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => {
            if (res.statusCode !== 200 || data.length < 50) {
              resolve({ success: false, error: 'Failed to download skill (not found)' });
              return;
            }
            fss.mkdirSync(targetDir, { recursive: true });
            fss.writeFileSync(pth.join(targetDir, 'SKILL.md'), data, 'utf-8');
            resolve({ success: true, dirName });
          });
        }).on('error', (e: Error) => resolve({ success: false, error: e.message }));
      });
    } catch (e: any) { return { success: false, error: e.message }; }
  });

  // LLM 测试连接
  ipcMain.handle('llm:test', async (_e, cfg: LLMConfig) => {
    try {
      const { OpenAI } = await import('openai');
      const baseURL = cfg.baseUrl || undefined;
      console.log('[LLM Test] baseURL:', baseURL, 'model:', cfg.model);
      const client = new OpenAI({
        apiKey: cfg.apiKey,
        baseURL,
      });
      const start = Date.now();
      const resp = await client.chat.completions.create({
        model: cfg.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });
      const latency = Date.now() - start;
      return { success: true, latency, model: resp.model || cfg.model };
    } catch (err: any) {
      const msg = err.message || String(err);
      const status = err.status || err.statusCode;
      const detail = err.error?.message || err.error?.error?.message || '';
      console.error('[LLM Test] 失败:', status, msg, detail);
      let errorHint = msg;
      if (status === 401 || msg.includes('Incorrect API key') || msg.includes('Invalid API Key')) {
        errorHint = 'API Key 无效，请检查是否正确';
      } else if (status === 404 || msg.includes('model_not_found') || msg.includes('does not exist')) {
        errorHint = `模型 ${cfg.model} 不存在，请检查模型名称或 Base URL 是否正确`;
      } else if (status === 400 && detail) {
        errorHint = detail;
      } else if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) {
        errorHint = '无法连接服务器，请检查 Base URL';
      } else if (msg.includes('fetch failed') || msg.includes('NetworkError')) {
        errorHint = '网络错误，请检查 Base URL 是否正确';
      }
      return { success: false, error: errorHint };
    }
  });

  ipcMain.handle(
    'tool:confirm:response',
    async (_e, { messageId, approved, modified }: { messageId: string; approved: boolean; modified?: string }) => {
      resolveToolConfirmation(messageId, approved, modified);
      return;
    }
  );

  ipcMain.on('app:log', (_e, msg) => {
    console.log('[app]', msg);
  });
}
