import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { app } from 'electron';
import * as vm from 'vm';
import type { SkillInfo, SkillParameter, SkillExecutionResult } from '../../src/shared/types';

function getSkillsDir(): string {
  const base = process.env.APPCLAW_SKILLS_DIR || path.join(homedir(), '.appclaw', 'skills');
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

export async function getSkillMeta(skillId: string): Promise<SkillInfo | null> {
  const dirPath = path.join(getSkillsDir(), skillId);
  const parsed = parseSKILLMarkdown(dirPath);
  if (!parsed) return null;
  const indexPath = path.join(dirPath, 'index.js');
  const type: 'declarative' | 'code' = parsed.metadata.type || (fs.existsSync(indexPath) ? 'code' : 'declarative');
  return {
    id: skillId,
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    trigger: parsed.metadata.trigger,
    type,
    tools: parsed.metadata.tools || [],
    parameters: parsed.metadata.parameters || [],
    enabled: parsed.metadata.enabled !== false,
    source: 'local',
    installedAt: fs.existsSync(dirPath) ? fs.statSync(dirPath).mtime.toISOString() : new Date().toISOString(),
  };
}

export async function executeSkill(skillId: string, params: Record<string, string>): Promise<SkillExecutionResult> {
  const dirPath = path.join(getSkillsDir(), skillId);
  const indexPath = path.join(dirPath, 'index.js');
  if (!fs.existsSync(indexPath)) {
    return { success: false, error: 'Code skill index.js not found' };
  }
  try {
    const code = fs.readFileSync(indexPath, 'utf-8');
    const exportsObj: any = { exports: {} };
    const context = vm.createContext({
      module: exportsObj,
      exports: exportsObj.exports,
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
    
    const finalExports = exportsObj.exports || context.module?.exports || context.exports;
    if (finalExports && typeof finalExports.execute === 'function') {
      const runContext = {
        console,
        cwd: () => process.cwd(),
      };
      const resultObj = await finalExports.execute(params, runContext);
      const output = resultObj && typeof resultObj === 'object' && 'output' in resultObj
        ? resultObj.output
        : resultObj;
      return { success: true, output: typeof output === 'string' ? output : JSON.stringify(output) };
    }
    
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

export async function exportSkill(skillId: string): Promise<string | null> {
  const dirPath = path.join(getSkillsDir(), skillId);
  if (!fs.existsSync(dirPath)) return null;
  
  // 使用 JSZip 打包
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  
  const files = fs.readdirSync(dirPath, { recursive: true }) as string[];
  for (const f of files) {
    const fullPath = path.join(dirPath, f);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      zip.file(f, fs.readFileSync(fullPath));
    }
  }
  
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer.toString('base64');
}

export async function importSkill(zipBase64: string): Promise<SkillInfo | null> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'));
  
  const parsed = await parseSkillMarkdownFromZip(zip);
  if (!parsed) return null;
  
  const skillId = (parsed.metadata.name || 'imported-skill').toLowerCase().replace(/\s+/g, '-');
  const dirPath = path.join(getSkillsDir(), skillId);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
  
  for (const [filename, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const content = await file.async('nodebuffer');
    const targetPath = path.join(dirPath, filename);
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, content);
  }
  
  return getSkillMeta(skillId);
}

async function parseSkillMarkdownFromZip(zip: any): Promise<ParsedSkill | null> {
  let mdFile = zip.file('SKILL.md');
  if (!mdFile) {
    for (const [name, file] of Object.entries(zip.files) as any) {
      if (name.endsWith('SKILL.md') || name.endsWith('skill.md')) {
        mdFile = file;
        break;
      }
    }
  }
  if (!mdFile) return null;
  
  const content = await mdFile.async('string');
  const { metadata, body } = parseFrontmatter(content);
  return {
    metadata: {
      name: metadata.name || 'imported-skill',
      description: metadata.description || '',
      trigger: metadata.trigger || ('/' + (metadata.name || 'imported-skill').toLowerCase().replace(/\s+/g, '-')),
      type: metadata.type || 'declarative',
      tools: metadata.tools || [],
      parameters: metadata.parameters || [],
      enabled: metadata.enabled !== false,
    },
    systemPrompt: body.trim(),
  };
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author?: string;
  stars?: number;
  url: string;
  category?: string;
}

export async function searchMarketplace(query: string): Promise<MarketplaceSkill[]> {
  const https = await import('https');
  
  const searchUrl = query 
    ? `https://skills.sh/search?q=${encodeURIComponent(query)}`
    : 'https://skills.sh/';
  
  return new Promise((resolve) => {
    https.get(searchUrl, {
      headers: {
        'User-Agent': 'AppClaw-Desktop/1.0',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const skills = parseSkillsFromHtml(data);
          resolve(skills);
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => {
      resolve([]);
    });
  });
}

function parseSkillsFromHtml(html: string): MarketplaceSkill[] {
  const skills: MarketplaceSkill[] = [];
  
  const cardRegex = /<a[^>]*href="(https?:\/\/[^"]*\/skill\/[^"]+)"[^>]*class="[^"]*card[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<p[^>]*class="[^"]*desc[^"]*"[^>]*>([^<]*)<\/p>[\s\S]*?<\/a>/gi;
  
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const url = match[1];
    const name = match[2].trim();
    const description = match[3].trim();
    const id = url.split('/').pop() || name.toLowerCase().replace(/\s+/g, '-');
    
    skills.push({
      id,
      name,
      description,
      url,
      category: 'general'
    });
  }
  
  if (skills.length === 0) {
    const fallbackRegex = /<a[^>]*href="(https?:\/\/www\.skills\.sh\/([^"]+))"[^>]*>[\s\S]*?<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<\/a>/gi;
    let fmatch;
    while ((fmatch = fallbackRegex.exec(html)) !== null) {
      const url = fmatch[1];
      const slug = fmatch[2];
      const name = fmatch[3].trim();
      if (slug && !slug.includes('/') && name && name.length < 100) {
        skills.push({
          id: slug,
          name,
          description: '来自 skills.sh 的 Skill',
          url,
          category: 'general'
        });
      }
    }
  }
  
  return skills.slice(0, 30);
}

export async function installFromMarketplace(skillUrl: string): Promise<SkillInfo | null> {
  const https = await import('https');
  const JSZip = (await import('jszip')).default;
  
  const rawUrl = skillUrl.replace(/\/$/, '');
  const downloadUrl = rawUrl.includes('github.com') 
    ? `${rawUrl}/archive/refs/heads/main.zip`
    : null;
  
  const skillMdUrl = rawUrl.includes('skills.sh')
    ? null
    : null;
  
  try {
    const skillPageContent = await fetchHtml(rawUrl);
    const skillMdContent = extractSkillMarkdown(skillPageContent);
    
    if (skillMdContent) {
      const { metadata, body } = parseFrontmatter(skillMdContent);
      const skillName = metadata.name || extractSkillName(skillPageContent) || 'marketplace-skill';
      const skillId = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const dirPath = path.join(getSkillsDir(), skillId);
      
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
      fs.mkdirSync(dirPath, { recursive: true });
      
      const frontmatter = [
        '---',
        `name: ${skillName}`,
        `description: ${metadata.description || extractSkillDescription(skillPageContent) || ''}`,
        `trigger: ${metadata.trigger || '/' + skillId}`,
        `type: ${metadata.type || 'declarative'}`,
        metadata.tools?.length ? `tools: [${metadata.tools.join(', ')}]` : '',
        `enabled: true`,
        `source: marketplace`,
        '---',
        '',
        body || skillMdContent.slice(0, 2000),
      ].filter(Boolean).join('\n');
      
      fs.writeFileSync(path.join(dirPath, 'SKILL.md'), frontmatter, 'utf-8');
      
      return getSkillMeta(skillId);
    }
    
    if (downloadUrl) {
      const zipBuffer = await downloadFile(downloadUrl);
      const zip = await JSZip.loadAsync(zipBuffer);
      
      const parsed = await parseSkillMarkdownFromZip(zip);
      if (!parsed) return null;
      
      const skillId = (parsed.metadata.name || 'marketplace-skill').toLowerCase().replace(/\s+/g, '-');
      const dirPath = path.join(getSkillsDir(), skillId);
      
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
      fs.mkdirSync(dirPath, { recursive: true });
      
      const prefix = findZipRoot(zip);
      for (const [filename, file] of Object.entries(zip.files)) {
        if (file.dir) continue;
        const relativePath = prefix ? filename.replace(prefix, '') : filename;
        if (!relativePath) continue;
        const content = await file.async('nodebuffer');
        const targetPath = path.join(dirPath, relativePath);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, content);
      }
      
      return getSkillMeta(skillId);
    }
    
    return null;
  } catch (err) {
    console.error('Marketplace install error:', err);
    return null;
  }
}

function findZipRoot(zip: any): string {
  const files = Object.keys(zip.files);
  if (files.length === 0) return '';
  const firstFile = files[0];
  const parts = firstFile.split('/');
  if (parts.length > 1 && zip.files[parts[0] + '/']) {
    return parts[0] + '/';
  }
  return '';
}

function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, {
      headers: {
        'User-Agent': 'AppClaw-Desktop/1.0',
        'Accept': 'text/html,application/xhtml+xml'
      }
    }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHtml(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function downloadFile(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, {
      headers: {
        'User-Agent': 'AppClaw-Desktop/1.0'
      }
    }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location).then(resolve).catch(reject);
        return;
      }
      
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function extractSkillMarkdown(html: string): string | null {
  const patterns = [
    /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    /<code[^>]*class="[^"]*markdown[^"]*"[^>]*>([\s\S]*?)<\/code>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const content = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<br\s*\/?>/gi, '\n');
      
      if (content.includes('---') && (content.includes('name:') || content.includes('trigger:'))) {
        return content.trim();
      }
    }
  }
  
  return null;
}

function extractSkillName(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (match) {
    return match[1].split('|')[0].split('-')[0].trim();
  }
  return null;
}

function extractSkillDescription(html: string): string | null {
  const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
  if (metaMatch) return metaMatch[1];
  
  const ogMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"[^>]*>/i);
  if (ogMatch) return ogMatch[1];
  
  return null;
}
