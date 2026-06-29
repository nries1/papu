import axios from 'axios';
import { appLog } from '../database/dao';

type Message = { role: string; content: string };

export async function ollamaChat(messages: Message[]): Promise<string> {
  try {
    const response = await axios.post<{ message: { content: string } }>(
      process.env.OLLAMA_URL ?? 'http://ollama:11434/api/chat',
      { model: process.env.OLLAMA_MODEL ?? 'qwen3.5:9b', messages, stream: false }
    );
    return response.data.message.content;
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
