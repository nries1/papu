import axios from 'axios';
import { appLog } from '../database/dao';

type Message = { role: string; content: string; tool_calls?: OllamaToolCall[]; tool_call_id?: string };

export interface OllamaToolCall {
  id: string;
  function: { name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  content: string;
  tool_calls?: OllamaToolCall[];
}

async function callOllama(messages: Message[], tools?: object[]): Promise<OllamaMessage> {
  try {
    const body: Record<string, unknown> = {
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:3b',
      messages,
      stream: false,
    };
    if (tools?.length) body.tools = tools;

    const response = await axios.post<{ message: OllamaMessage }>(
      process.env.OLLAMA_URL ?? 'http://ollama:11434/api/chat',
      body
    );
    const msg = response.data.message;
    if (msg.content) msg.content = msg.content.trim();
    return msg;
  } catch (err) {
    await appLog({
      message: 'Ollama request failed',
      details: {
        code: (err as any).code,
        status: (err as any).response?.status,
        ollamaError: (err as any).response?.data,
        stack: (err as Error).stack,
      },
      source: 'ollama',
      level: 'error',
    });
    throw err;
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  const base = (process.env.OLLAMA_URL ?? 'http://ollama:11434/api/chat').replace('/api/chat', '');
  const response = await axios.post<{ embeddings: number[][] }>(`${base}/api/embed`, {
    model: 'nomic-embed-text',
    input: text,
  });
  return response.data.embeddings[0];
}

export async function ollamaChat(messages: Message[]): Promise<string> {
  const msg = await callOllama(messages);
  return msg.content;
}

export async function ollamaChatWithTools(messages: Message[], tools: object[]): Promise<OllamaMessage> {
  return callOllama(messages, tools);
}
