import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.length > 0 ? wins[0] : null;
}
import { chat, setLLMConfig, getLLMConfig } from './llm-provider';
import {
  buildContextMessages,
  saveMessage,
  getAgent,
  logToolExecution,
  addMemory,
  triggerNudge
} from './memory-service';
import {
  callTool,
  getToolDefinitions,
  getToolPreview,
  getToolRisk,
  needsConfirmation
} from './mcp-manager';
import type { AgentConfig, ChatMessage, LLMConfig } from '../../src/shared/types';

const pendingConfirms = new Map<string, { resolve: (approved: boolean) => void; toolName: string; args: Record<string, any> }>();

export async function sendChatMessage(
  sessionId: string,
  userMessage: string,
  agentId: string
): Promise<ChatMessage> {
  const agent = (await getAgent(agentId)) || defaultAgent();

  await saveMessage({
    sessionId,
    role: 'user',
    content: userMessage
  });

  const assistantId = uuidv4();
  await saveMessage({
    id: assistantId,
    sessionId,
    role: 'assistant',
    content: '',
    pending: true
  } as any);

  await runAgentTurn(sessionId, agent, assistantId, userMessage);

  const finalMessages = await import('./memory-service').then((m) => m.listMessages(sessionId));
  const assistantMsg = finalMessages.find((m) => m.id === assistantId) || finalMessages[finalMessages.length - 1];
  return assistantMsg;
}

async function runAgentTurn(
  sessionId: string,
  agent: AgentConfig,
  assistantMessageId: string,
  userQuery: string,
  depth: number = 0
): Promise<void> {
  if (depth > 6) return;

  const win = getMainWindow();
  const contextMessages = await buildContextMessages(sessionId, userQuery, agent.id);
  const tools = getToolDefinitions(agent.tools);

  let fullContent = '';
  let currentToolCalls: any[] = [];

  const { content, toolCalls } = await chat({
    systemPrompt: agent.systemPrompt,
    messages: contextMessages,
    model: agent.model,
    temperature: agent.temperature,
    tools: tools.length > 0 ? tools : undefined,
    stream: true,
    onChunk: (delta, tc) => {
      if (delta) {
        fullContent += delta;
        win?.webContents.send('chat:stream', {
          messageId: assistantMessageId,
          delta,
          done: false
        });
      }
      if (tc) currentToolCalls = tc;
    }
  });

  if (toolCalls && toolCalls.length > 0) {
    currentToolCalls = toolCalls;
  }

  await updateAssistantMessage(sessionId, assistantMessageId, fullContent, currentToolCalls);

  if (currentToolCalls && currentToolCalls.length > 0) {
    for (const tc of currentToolCalls) {
      const result = await executeToolWithConfirmation(sessionId, tc.name, tc.arguments, agent);
      await saveMessage({
        sessionId,
        role: 'tool',
        content: result.content || '',
        toolResult: result.content,
        tool_call_id: tc.id
      } as any);
    }
    await runAgentTurn(sessionId, agent, assistantMessageId, userQuery, depth + 1);
  } else {
    if (!fullContent.trim()) {
      await updateAssistantMessage(sessionId, assistantMessageId, '抱歉，我没有得到有效的响应。请检查 API Key 和网络连接。', []);
    }

    const maybeExtract = shouldExtractMemory(userQuery, fullContent);
    if (maybeExtract) {
      addMemory(maybeExtract, 'fact').catch(() => {});
    }

    triggerNudge(sessionId).catch(() => {});

    win?.webContents.send('chat:stream', {
      messageId: assistantMessageId,
      delta: '',
      done: true
    });
  }
}

async function updateAssistantMessage(
  sessionId: string,
  messageId: string,
  content: string,
  toolCalls: any[]
): Promise<void> {
  const { getDb } = await import('./memory-service');
  const now = new Date().toISOString();
  const toolStr = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  await getDb().query(
    'UPDATE messages SET content = $1, tool_calls = $2 WHERE id = $3',
    [content || '', toolStr, messageId]
  );
  await getDb().query('UPDATE sessions SET updated_at = $1 WHERE id = $2', [now, sessionId]);
}

async function executeToolWithConfirmation(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  agent: AgentConfig
): Promise<{ content: string; success: boolean }> {
  const start = Date.now();
  const win = getMainWindow();
  const requireConfirm = needsConfirmation(toolName, agent.toolPermissions);

  if (requireConfirm && win) {
    const approved = await requestUserConfirmation(win, sessionId, toolName, args);
    if (!approved) {
      await logToolExecution(sessionId, toolName, args, false, Date.now() - start, false, '用户拒绝执行');
      return { success: false, content: '用户拒绝了该操作' };
    }
  }

  try {
    const result = await callTool(toolName, args);
    await logToolExecution(sessionId, toolName, args, result.success, Date.now() - start, requireConfirm, result.error);
    return result;
  } catch (err: any) {
    await logToolExecution(sessionId, toolName, args, false, Date.now() - start, requireConfirm, err.message);
    return { success: false, content: err.message || '工具调用失败' };
  }
}

function requestUserConfirmation(
  win: Electron.CrossProcessExports.BrowserWindow,
  sessionId: string,
  toolName: string,
  args: Record<string, any>
): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `${sessionId}-${Date.now()}-${Math.random().toString(36).substring(0, 6)}`;
    pendingConfirms.set(requestId, { resolve, toolName, args });

    const risk = getToolRisk(toolName);
    const preview = getToolPreview(toolName, args);

    win.webContents.send('tool:confirm:request', {
      messageId: requestId,
      toolName,
      args,
      preview,
      risk
    });

    setTimeout(() => {
      if (pendingConfirms.has(requestId)) {
        pendingConfirms.delete(requestId);
        resolve(false);
      }
    }, 120000);
  });
}

export function resolveToolConfirmation(messageId: string, approved: boolean, modified?: string): void {
  const pending = pendingConfirms.get(messageId);
  if (!pending) return;
  pendingConfirms.delete(messageId);
  pending.resolve(approved);
}

function defaultAgent(): AgentConfig {
  return {
    id: 'default-agent',
    name: '默认助手',
    model: 'gpt-4o-mini',
    systemPrompt:
      '你是 AppClaw，一个强大的桌面 AI 助手。你可以通过工具调用操作系统程序、浏览器、文件系统等。请用中文回复，回答简洁专业。当用户请求超出对话范围的操作时，使用相应的工具来完成任务。',
    temperature: 0.7,
    tools: ['memory', 'filesystem', 'browser'],
    toolPermissions: {}
  };
}

function shouldExtractMemory(query: string, response: string): string | null {
  const keywords = ['我叫', '我的名字', '我住', '我喜欢', '我的电话', '我的邮箱', '记住'];
  const lower = (query + ' ' + response).toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      const slice = (query + '\n' + response).slice(0, 400);
      return slice;
    }
  }
  return null;
}

export function applyLLMConfig(cfg: LLMConfig) {
  setLLMConfig(cfg);
}
