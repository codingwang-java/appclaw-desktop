import OpenAI from 'openai';
import type { LLMConfig } from '../../src/shared/types';

let client: OpenAI | null = null;
let currentConfig: LLMConfig | null = null;

interface ChatOptions {
  systemPrompt: string;
  messages: { role: string; content: string }[];
  model?: string;
  temperature?: number;
  tools?: any[];
  stream?: boolean;
  onChunk?: (delta: string, toolCalls?: any[]) => void;
}

export function setLLMConfig(config: LLMConfig) {
  currentConfig = config;
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY || 'sk-demo';
  const baseURL = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  client = new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: false
  });
}

export function getLLMConfig(): LLMConfig {
  return (
    currentConfig || {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    }
  );
}

export async function chat(options: ChatOptions): Promise<{ content: string; toolCalls?: any[] }> {
  if (!client) throw new Error('LLM 未配置，请在设置中填入 API Key');

  const config = getLLMConfig();
  const model = options.model || config.model || 'gpt-4o-mini';
  const temperature = options.temperature ?? 0.7;

  const messages: any[] = [
    { role: 'system', content: options.systemPrompt },
    ...options.messages.filter((m) => m.content && m.content.trim().length > 0)
  ];

  const requestParams: any = {
    model,
    messages,
    temperature
  };

  if (options.tools && options.tools.length > 0) {
    requestParams.tools = options.tools;
    requestParams.tool_choice = 'auto';
  }

  if (options.stream && options.onChunk) {
    const stream = await client!.chat.completions.create({ ...requestParams, stream: true });
    let fullContent = '';
    let toolCalls: any[] = [];

    const streamIter = stream as unknown as AsyncIterable<any>;
    for await (const chunk of streamIter) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        fullContent += delta.content;
        options.onChunk(delta.content);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id, name: tc.function?.name || '', arguments: '' };
          }
          if (tc.function?.arguments) {
            toolCalls[idx].arguments += tc.function.arguments;
          }
        }
      }
    }

    const parsedToolCalls = toolCalls
      .filter((tc) => tc.id && tc.name)
      .map((tc) => {
        try {
          return { id: tc.id, name: tc.name, arguments: JSON.parse(tc.arguments || '{}') };
        } catch {
          return { id: tc.id, name: tc.name, arguments: {} };
        }
      });

    return { content: fullContent, toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined };
  }

  const response = await client!.chat.completions.create(requestParams);
  const msg = response.choices[0]?.message;
  const content = msg?.content || '';
  const toolCalls = msg?.tool_calls?.map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.function.arguments);
      } catch {
        return {};
      }
    })()
  }));

  return { content, toolCalls };
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!client) return [];
  const config = getLLMConfig();
  const model = config.embeddingModel || 'text-embedding-3-small';
  try {
    const res = await client.embeddings.create({ model, input: text.slice(0, 4000) });
    return res.data[0]?.embedding || [];
  } catch (e) {
    return [];
  }
}
