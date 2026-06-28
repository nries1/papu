import { ollamaChat } from './ollama';
import { waterPlants, getLightEntities, controlLight, LightCommand } from './homeActions';
import type { LightEntityInfo } from './homeActions';
import {
  getAllHomeKnowledge,
  insertHomeKnowledge,
  updateHomeKnowledge,
  deleteHomeKnowledge,
  getRecentSessionSummaries,
  getChatMessages,
  appendChatMessage,
  setChatSessionSummary,
  appLog,
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

const LIGHT_KEYWORDS = ['light', 'lights', 'lamp', 'bulb', 'dim', 'brighten', 'bright', 'couch', 'kitchen', 'bedroom', 'hallway', 'living room'];

function looksLikeLightRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return LIGHT_KEYWORDS.some((k) => lower.includes(k));
}

const SCENE_PRESETS: Record<string, { brightness_pct: number; rgb_color: [number, number, number] }> = {
  movie: { brightness_pct: 15, rgb_color: [255, 100, 20] },
  relax: { brightness_pct: 35, rgb_color: [255, 170, 60] },
  cozy: { brightness_pct: 35, rgb_color: [255, 170, 60] },
  morning: { brightness_pct: 80, rgb_color: [200, 225, 255] },
  focus: { brightness_pct: 100, rgb_color: [220, 230, 255] },
  bright: { brightness_pct: 100, rgb_color: [255, 255, 255] },
};

const SCENE_LIST = Object.entries(SCENE_PRESETS)
  .map(([name, p]) => `"${name}": ${p.brightness_pct}% brightness, rgb [${p.rgb_color.join(',')}]`)
  .join('; ');

// Room aliases: keyword → filter function against available entities
const ROOM_ALIASES: Array<[string, (e: LightEntityInfo) => boolean]> = [
  ['all lights', () => true],
  ['all the lights', () => true],
  ['every light', () => true],
  ['living room', (e) => e.entity_id.includes('couch')],
  ['couch', (e) => e.entity_id.includes('couch')],
  ['kitchen', (e) => e.entity_id.includes('kitchen')],
  ['bedroom', (e) => e.entity_id.includes('bedroom')],
  ['hallway', (e) => e.entity_id.includes('hallway')],
];

// Fast rule-based parser for simple on/off commands. Returns null if too complex for rules.
function trySimpleLightParse(message: string, availableLights: LightEntityInfo[]): LightCommand | null {
  const lower = message.toLowerCase();

  const isOff = /\boff\b/.test(lower);
  const isOn = /\bon\b/.test(lower);
  if (!isOff && !isOn) return null;
  const action: 'turn_on' | 'turn_off' = isOff ? 'turn_off' : 'turn_on';

  // Reject if this looks like it has color/brightness/scene modifiers — let LLM handle those
  const hasComplex = /\b(dim|bright|percent|%|color|colour|warm|cool|movie|scene|morning|relax|cozy|focus|kelvin|rgb)\b/.test(lower);
  if (hasComplex) return null;

  const matched = new Set<string>();
  for (const [pattern, matcher] of ROOM_ALIASES) {
    if (lower.includes(pattern)) {
      availableLights.filter(matcher).forEach((l) => matched.add(l.entity_id));
    }
  }
  if (!matched.size) return null;

  return { entity_ids: [...matched], action };
}

async function detectAndExecuteLightCommand(
  userMessage: string,
  availableLights: LightEntityInfo[]
): Promise<{ executed: boolean; summary: string }> {
  if (!availableLights.length) return { executed: false, summary: 'No smart lights are available.' };

  // Fast path: try rule-based parsing first (reliable, no LLM needed)
  const simple = trySimpleLightParse(userMessage, availableLights);
  if (simple) {
    await appLog({ message: 'light simple parse', details: { userMessage, cmd: simple }, source: 'chatContext', level: 'info' });
    const result = await controlLight(simple);
    await appLog({ message: 'light control result', details: { success: result.success, summary: result.summary }, source: 'chatContext', level: result.success ? 'info' : 'error' });
    return { executed: result.success, summary: result.summary };
  }

  // Slow path: LLM for complex commands (color, brightness, scenes)
  const roomMap = ROOM_ALIASES
    .map(([name]) => {
      const matches = availableLights.filter(ROOM_ALIASES.find(([n]) => n === name)![1]).map((l) => l.entity_id);
      return matches.length ? `  - "${name}": ${matches.join(', ')}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const allIds = availableLights.map((l) => `${l.entity_id} (${l.friendly_name})`).join(', ');

  const prompt = `Control smart lights. Extract a command from the user request.

Room groups:
${roomMap}

All lights: ${allIds}

Scenes: ${SCENE_LIST}

User: "${userMessage}"

Reply with ONLY a JSON object — no explanation, no markdown:
{"entity_ids":["light.example"],"action":"turn_on","brightness_pct":50,"rgb_color":[255,100,0]}

Only include brightness_pct, rgb_color, or kelvin when the user specifies them or names a scene.
If no lights apply, reply with: null`;

  let raw = '';
  try {
    raw = await ollamaChat([{ role: 'user', content: prompt }]);

    await appLog({ message: 'light llm parse', details: { userMessage, llmResponse: raw }, source: 'chatContext', level: 'info' });

    const trimmed = raw.trim();
    if (/^null/i.test(trimmed)) return { executed: false, summary: 'I couldn\'t figure out which lights you meant.' };

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { executed: false, summary: 'Could not parse a light command from that request.' };

    const parsed = JSON.parse(jsonMatch[0]) as Partial<LightCommand>;
    if (!parsed.entity_ids || !parsed.action) return { executed: false, summary: 'Light command was incomplete.' };

    const validIds = new Set(availableLights.map((l) => l.entity_id));
    const filteredIds = parsed.entity_ids.filter((id) => validIds.has(id));

    await appLog({ message: 'light llm resolved', details: { parsed, filteredIds }, source: 'chatContext', level: 'info' });

    if (!filteredIds.length) return { executed: false, summary: `No matching lights found. Available rooms: couch/living room, kitchen, bedroom, hallway.` };

    const cmd: LightCommand = {
      entity_ids: filteredIds,
      action: parsed.action,
      ...(parsed.brightness_pct !== undefined && { brightness_pct: parsed.brightness_pct }),
      ...(parsed.rgb_color && { rgb_color: parsed.rgb_color }),
      ...(parsed.kelvin && { kelvin: parsed.kelvin }),
    };

    const result = await controlLight(cmd);
    await appLog({ message: 'light control result', details: { cmd, success: result.success, summary: result.summary }, source: 'chatContext', level: result.success ? 'info' : 'error' });
    return { executed: result.success, summary: result.summary };
  } catch (e) {
    await appLog({ message: e instanceof Error ? e : new Error(String(e)), details: { userMessage, llmResponse: raw }, source: 'chatContext', level: 'error' });
    return { executed: false, summary: `Light control error: ${e instanceof Error ? e.message : String(e)}` };
  }
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
  const [knowledgeRows, summaries, users, lights] = await Promise.all([
    getAllHomeKnowledge(),
    getRecentSessionSummaries(5),
    db.selectFrom('users').selectAll().execute().catch(() => []),
    getLightEntities().catch(() => [] as LightEntityInfo[]),
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

  if (lights.length > 0) {
    const lightLines = lights
      .map((l) => `  - ${l.friendly_name}: ${l.state}${l.brightness_pct !== undefined ? ` (${l.brightness_pct}%)` : ''}`)
      .join('\n');
    sections.push(`== Smart lights I can control ==\n${lightLines}`);
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
      `== Home action result ==\n` +
        `The system attempted to perform a home action. Result:\n${pendingAction}\n` +
        `Report this result accurately — if it succeeded, confirm it; if it failed, say so honestly. Do NOT claim an action was taken if the result indicates failure.`
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
  } else if (looksLikeLightRequest(userMessage)) {
    const availableLights = await getLightEntities();
    const result = await detectAndExecuteLightCommand(userMessage, availableLights);
    // Always set pendingAction so the LLM knows the real outcome (success or failure)
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
