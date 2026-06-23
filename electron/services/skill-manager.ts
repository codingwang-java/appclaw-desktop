import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import * as vm from 'vm';
import type { SkillInfo, SkillParameter, SkillExecutionResult } from '../../src/shared/types';

function getSkillsDir(): string {
  const base = process.env.APPCLAW_SKILLS_DIR || path.join(os.homedir(), '.appclaw', 'skills');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

interface ParsedSkill {
  metadata: {
    name: string;
    description: string;
    trigger: string;
    type: 'declarative' | 'code';
    tools?: string[];
    parameters?: SkillParameter[];
    enabled?: boolean;
  };
  systemPrompt: string;
}

function parseFrontmatter(content: string): { metadata: Record<string, any>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };
  const yamlStr = match[1];
  const body = match[2] || '';
  const metadata: Record<string, any> = {};
  for (const line of yamlStr.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value: any = line.slice(idx + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    metadata[key] = value;
  }
  return { metadata, body };
}

function parseSKILLMarkdown(dirPath: string): ParsedSkill | null {
  const mdPath = path.join(dirPath, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return null;
  const content = fs.readFileSync(mdPath, 'utf-8');
  const { metadata, body } = parseFrontmatter(content);
  return {
    metadata: {
      name: metadata.name || path.basename(dirPath),
      description: metadata.description || '',
      trigger: metadata.trigger || ('/' + (metadata.name || path.basename(dirPath)).toLowerCase().replace(/\s+/g, '-')),
      type: metadata.type || 'declarative',
      tools: metadata.tools || [],
      parameters: metadata.parameters || [],
      enabled: metadata.enabled !== false,
    },
    systemPrompt: body.trim(),
  };
}

export async function listSkills(): Promise<SkillInfo[]> {
  const base = getSkillsDir();
  if (!fs.existsSync(base)) return [];
  const entries = fs.readdirSync(base, { withFileTypes: true });
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(base, entry.name);
    const parsed = parseSKILLMarkdown(dirPath);
    if (!parsed) continue;
    const indexPath = path.join(dirPath, 'index.js');
    const type: 'declarative' | 'code' = parsed.metadata.type || (fs.existsSync(indexPath) ? 'code' : 'declarative');
    skills.push({
      id: entry.name,
      name: parsed.metadata.name,
      description: parsed.metadata.description,
      trigger: parsed.metadata.trigger,
      type,
      tools: parsed.metadata.tools || [],
      parameters: parsed.metadata.parameters || [],
      enabled: parsed.metadata.enabled !== false,
      source: 'local',
      installedAt: fs.existsSync(dirPath) ? fs.statSync(dirPath).mtime.toISOString() : new Date().toISOString(),
    });
  }
  return skills;
}

export async function executeSkill(skillId: string, params: Record<string, string>): Promise<SkillExecutionResult> {
  const dirPath = path.join(getSkillsDir(), skillId);
  const indexPath = path.join(dirPath, 'index.js');
  if (!fs.existsSync(indexPath)) {
    return { success: false, error: 'Code skill index.js not found' };
  }
  try {
    const code = fs.readFileSync(indexPath, 'utf-8');
    const context = vm.createContext({
      module: { exports: {} },
      exports: {},
      require: (name: string) => {
        if (name === 'index.js') return {};
        try { return require(name); } catch { return {}; }
      },
      console,
      params,
      result: undefined as any,
      setResult: (r: any) => { (global as any).result = r; },
    });
    vm.runInContext(code, context, { timeout: 30000 });
    const result = (vm as any).result || (context as any).result;
    return { success: true, output: typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function parseTriggerCommand(input: string): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.slice(1).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (!parts.length) return null;
  return { command: parts[0], args: parts.slice(1) };
}

export async function getSkillSystemPrompt(skillId: string): Promise<string | null> {
  const dirPath = path.join(getSkillsDir(), skillId);
  const parsed = parseSKILLMarkdown(dirPath);
  return parsed ? `DECLARATIVE:${parsed.systemPrompt}` : null;
}

export async function createSkill(skill: Omit<SkillInfo, 'installedAt'> & { systemPrompt?: string }): Promise<boolean> {
  const dirPath = path.join(getSkillsDir(), skill.id);
  if (fs.existsSync(dirPath)) return false;
  fs.mkdirSync(dirPath, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `trigger: ${skill.trigger}`,
    `type: ${skill.type}`,
    skill.tools?.length ? `tools: [${skill.tools.join(', ')}]` : '',
    skill.parameters?.length ? `parameters:` : '',
    ...(skill.parameters || []).map(p => `  - ${p.name}: ${p.label} (${p.type}, ${p.required ? 'required' : 'optional'})`),
    `enabled: ${skill.enabled}`,
    '---',
    '',
    skill.systemPrompt || '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(dirPath, 'SKILL.md'), frontmatter, 'utf-8');
  return true;
}

export async function saveSkill(skillId: string, updates: Partial<SkillInfo> & { systemPrompt?: string }): Promise<boolean> {
  const dirPath = path.join(getSkillsDir(), skillId);
  const existing = parseSKILLMarkdown(dirPath);
  if (!existing) return false;
  const merged = { ...existing.metadata, ...updates };
  const frontmatter = [
    '---',
    `name: ${merged.name}`,
    `description: ${merged.description}`,
    `trigger: ${merged.trigger}`,
    `type: ${merged.type}`,
    merged.tools?.length ? `tools: [${merged.tools.join(', ')}]` : '',
    merged.parameters?.length ? `parameters:` : '',
    ...(merged.parameters || []).map((p: SkillParameter) => `  - ${p.name}: ${p.label} (${p.type}, ${p.required ? 'required' : 'optional'})`),
    `enabled: ${merged.enabled}`,
    '---',
    '',
    updates.systemPrompt || existing.systemPrompt,
  ].filter(Boolean).join('\n');
  fs.writeFileSync(path.join(dirPath, 'SKILL.md'), frontmatter, 'utf-8');
  if (updates.systemPrompt === undefined && existing.systemPrompt) {
  }
  return true;
}

export async function deleteSkill(skillId: string): Promise<boolean> {
  const dirPath = path.join(getSkillsDir(), skillId);
  if (!fs.existsSync(dirPath)) return false;
  fs.rmSync(dirPath, { recursive: true, force: true });
  return true;
}

export function getSkillDir(skillId: string): string {
  return path.join(getSkillsDir(), skillId);
}

export function skillExists(skillId: string): boolean {
  return fs.existsSync(path.join(getSkillsDir(), skillId, 'SKILL.md'));
}
