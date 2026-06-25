import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import type { LLMConfig, MCPServerConfig, WorkspaceConfig } from '../../src/shared/types';
import { initDatabase } from './memory-service';
import { setLLMConfig, getLLMConfig } from './llm-provider';
import { startMCPServer } from './mcp-manager';

const APP_DIR = path.join(homedir(), '.appclaw');
const DEFAULT_WORKSPACE_DIR = path.join(APP_DIR, 'workspaces', 'default');
const DB_PATH = path.join(DEFAULT_WORKSPACE_DIR, 'memory.db');
const CONFIG_PATH = path.join(DEFAULT_WORKSPACE_DIR, 'config.json');

let cachedConfig: WorkspaceConfig | null = null;
let projectRoot: string = '';

export async function initializeWorkspace(): Promise<void> {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
  if (!fs.existsSync(DEFAULT_WORKSPACE_DIR)) fs.mkdirSync(DEFAULT_WORKSPACE_DIR, { recursive: true });

  projectRoot = findProjectRoot();
  await initDatabase(DB_PATH);

  let cfg: WorkspaceConfig;
  if (fs.existsSync(CONFIG_PATH)) {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } else {
    cfg = defaultConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  cachedConfig = cfg;

  if (cfg.llm?.apiKey) {
    setLLMConfig(cfg.llm);
  }

  for (const server of cfg.mcpServers || []) {
    if (server.enabled) {
      try {
        await startMCPServer(server, projectRoot);
      } catch (err) {
        console.error(`启动 MCP server [${server.id}] 失败:`, err);
      }
    }
  }
}

function findProjectRoot(): string {
  const candidates = [process.cwd(), path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..')];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  return process.cwd();
}

function defaultConfig(): WorkspaceConfig {
  const env = process.env;
  const llm: LLMConfig = {
    provider: (env.LLM_PROVIDER as LLMConfig['provider']) || 'openai',
    apiKey: env.OPENAI_API_KEY || env.LLM_API_KEY || '',
    baseUrl: env.OPENAI_BASE_URL || env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: env.OPENAI_MODEL || env.LLM_MODEL || 'gpt-4o-mini',
    embeddingModel: env.EMBEDDING_MODEL || 'text-embedding-3-small'
  };

  const mcpServers: MCPServerConfig[] = [
    {
      id: 'filesystem',
      name: '文件系统工具',
      command: 'node',
      args: ['mcp-servers/filesystem/server.js'],
      enabled: true
    },
    {
      id: 'browser',
      name: '浏览器工具',
      command: 'node',
      args: ['mcp-servers/browser/server.js'],
      enabled: true
    }
  ];

  return {
    id: 'default',
    name: '默认工作区',
    path: DEFAULT_WORKSPACE_DIR,
    agents: [],
    llm,
    mcpServers
  };
}

export function getWorkspace(): WorkspaceConfig {
  return cachedConfig || defaultConfig();
}

export function listWorkspaces(): WorkspaceConfig[] {
  return cachedConfig ? [cachedConfig] : [];
}

export function saveWorkspace(cfg: WorkspaceConfig): boolean {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    cachedConfig = cfg;
    if (cfg.llm?.apiKey) {
      setLLMConfig(cfg.llm);
    }
    return true;
  } catch (err) {
    console.error('保存配置失败:', err);
    return false;
  }
}

export function getCurrentLLMConfig(): LLMConfig {
  return cachedConfig?.llm || getLLMConfig();
}

export function saveLLMConfig(cfg: LLMConfig): boolean {
  const workspace = getWorkspace();
  workspace.llm = cfg;
  return saveWorkspace(workspace);
}

export function getProjectRoot(): string {
  return projectRoot;
}
