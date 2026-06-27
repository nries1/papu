import { ollamaChat } from './ollama';
import { waterPlants } from './homeActions';
import {
  getAllHomeKnowledge,
  insertHomeKnowledge,
  updateHomeKnowledge,
  deleteHomeKnowledge,
  getRecentSessionSummaries,
  getChatMessages,
  appendChatMessage,
  setChatSessionSummary,
} from '../database/dao';
import { db } from '../database/db';
import type { HomeKnowledge } from '../database/types';

const UPDATE_TRIGGERS = [
  'remember that',
  'update your knowledge',
  'update your memory',
  'update your notes',
  'make a note',
  'note that',
  'take note',
  'add to your knowledge',
  'forget that',
];

function looksLikeKnowledgeUpdate(message: string): boolean {
  const lower = message.toLowerCase();
  return UPDATE_TRIGGERS.some((t) => lower.includes(t));
}

const WATERING_TRIGGERS = [
  'water the plants',
  'water plants',
  'start watering',
  'water them',
  'turn on the water',
  'run the pump',
];

function looksLikeWaterRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return WATERING_TRIGGERS.some((t) => lower.includes(t));
}

interface KnowledgeChange {
  action: 'add' | 'update' | 'delete';
  id?: number;
  subject?: string;
  category?: string;
  fact?: string;
}

async function detectAndApplyKnowledgeUpdates(
  userMessage: string,
  existingFacts: HomeKnowledge[]
): Promise<{ updated: boolean; summary: string }> {
  const factsContext = existingFacts.length
    ? existingFacts.map((f) => `  [id:${f.id}] [${f.subject} / ${f.category}] ${f.fact}`).join('\n')
    : '  (none yet)';

  const prompt = `You are a knowledge base manager for Papu, a home robot assistant.

Current knowledge base:
${factsContext}

The user said: "${userMessage}"

Extract the knowledge base changes requested. For each change:
- "add": brand-new fact not already in the list (provide subject, category, fact)
- "update": replace an existing fact (provide id from the list, plus new subject/category/fact)
- "delete": remove a fact entirely (provide id only)

Categories: identity, hobby, health, work, schedule, preference, social, home, contact

Rules:
- Write facts as complete third-person sentences (e.g. "Arlo does not like watching Ms. Rachel.")
- When something is said to be no longer true, prefer "update" over "delete" — rewrite the fact
- subject should be the person or thing the fact is about

Return ONLY a valid JSON array. If nothing should change, return [].
[{"action":"add|update|delete","id":null,"subject":"...","category":"...","fact":"..."}]`;

  try {
    const raw = await ollamaChat([{ role: 'user', content: prompt }]);
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return { updated: false, summary: '' };
    const changes: KnowledgeChange[] = JSON.parse(match[0]);
    if (!Array.isArray(changes) || !changes.length) return { updated: false, summary: '' };

    const applied: string[] = [];
    for (const change of changes) {
      if (change.action === 'add' && change.subject && change.category && change.fact) {
        await insertHomeKnowledge(change.subject, change.category, change.fact);
        applied.push(`Added: "${change.fact}"`);
      } else if (change.action === 'update' && change.id && change.subject && change.category && change.fact) {
        await updateHomeKnowledge(change.id, change.subject, change.category, change.fact);
        applied.push(`Updated: "${change.fact}"`);
      } else if (change.action === 'delete' && change.id) {
        const existing = existingFacts.find((f) => f.id === change.id);
        await deleteHomeKnowledge(change.id);
        applied.push(`Removed: "${existing?.fact ?? `fact #${change.id}`}"`);
      }
    }

    return { updated: applied.length > 0, summary: applied.join('\n') };
  } catch {
    return { updated: false, summary: '' };
  }
}

// Assembles the system prompt from home knowledge + session summaries + current context.
export async function buildSystemPrompt(
  personName: string | null,
  pendingUpdate: string | null = null,
  pendingAction: string | null = null
): Promise<string> {
  const [knowledgeRows, summaries, users] = await Promise.all([
    getAllHomeKnowledge(),
    getRecentSessionSummaries(5),
    db.selectFrom('users').selectAll().execute().catch(() => []),
  ]);

  const sections: string[] = [];

  sections.push(
    `You are Papu, a friendly home robot assistant with a warm and curious personality. ` +
      `You live in the home and help the people who live here. ` +
      `Keep responses natural and conversational. Avoid long lists or formal language.`
  );

  if (knowledgeRows.length > 0) {
    const bySubject: Record<string, string[]> = {};
    for (const row of knowledgeRows) {
      if (!bySubject[row.subject]) bySubject[row.subject] = [];
      bySubject[row.subject].push(`[${row.category}] ${row.fact}`);
    }
    const knowledgeText = Object.entries(bySubject)
      .map(([subject, lines]) => `== ${subject} ==\n${lines.join('\n')}`)
      .join('\n\n');
    sections.push(`== What I know about this home ==\n\n${knowledgeText}`);
  }

  if (users.length > 0) {
    const peopleLines = users.map((u) => `- ${u.display_name} (${u.email})`).join('\n');
    sections.push(`== People who live here ==\n${peopleLines}`);
  }

  if (summaries.length > 0) {
    sections.push(`== My memory of past conversations ==\n${summaries.join('\n')}`);
  }

  const seeing = personName
    ? `I can currently see ${personName}.`
    : `I cannot identify who I am looking at right now.`;
  sections.push(seeing);

  if (pendingUpdate) {
    sections.push(
      `== Knowledge base just updated ==\n` +
        `You just updated your memory based on what the user told you:\n${pendingUpdate}\n` +
        `Briefly acknowledge these changes naturally in your reply.`
    );
  }

  if (pendingAction) {
    sections.push(
      `== Home action just taken ==\n` +
        `You just performed the following action on behalf of the user:\n${pendingAction}\n` +
        `Briefly confirm what you did in your reply.`
    );
  }

  return sections.join('\n\n');
}

// Runs the full chat turn: saves the user message, queries Ollama with full context, saves reply.
export async function runChatTurn(
  sessionKey: string,
  userMessage: string,
  personName: string | null
): Promise<string> {
  await appendChatMessage(sessionKey, 'user', userMessage);

  let pendingUpdate: string | null = null;
  if (looksLikeKnowledgeUpdate(userMessage)) {
    const existingFacts = await getAllHomeKnowledge();
    const result = await detectAndApplyKnowledgeUpdates(userMessage, existingFacts);
    if (result.updated) pendingUpdate = result.summary;
  }

  let pendingAction: string | null = null;
  if (looksLikeWaterRequest(userMessage)) {
    const result = await waterPlants();
    pendingAction = result.summary;
  }

  const [systemPrompt, history] = await Promise.all([
    buildSystemPrompt(personName, pendingUpdate, pendingAction),
    getChatMessages(sessionKey),
  ]);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const reply = await ollamaChat(messages);
  await appendChatMessage(sessionKey, 'assistant', reply);
  return reply;
}

// Summarizes a completed session in the background (fire-and-forget).
export function summarizeSessionAsync(sessionKey: string): void {
  getChatMessages(sessionKey)
    .then((messages) => {
      if (messages.length < 2) return;
      const transcript = messages
        .map((m) => `${m.role === 'user' ? 'Human' : 'Papu'}: ${m.content}`)
        .join('\n');
      return ollamaChat([
        {
          role: 'system',
          content:
            'You are a summarizer. Given a conversation transcript, write a 1–3 sentence summary of what was discussed. Be factual and concise.',
        },
        {
          role: 'user',
          content: `Please summarize this conversation:\n\n${transcript}`,
        },
      ]);
    })
    .then((summary) => {
      if (summary) return setChatSessionSummary(sessionKey, summary);
    })
    .catch(() => {});
}
