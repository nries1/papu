import axios from 'axios';
import {
  getSystemLogs,
  getLatestEnvironmentReading,
  getWaterLevels,
  getRecentWateringEvents,
  getTankSensorHealthMetrics,
  saveAiSummary,
  appLog,
} from '../database/dao';

async function buildPrompt(): Promise<string> {
  const [
    { rows: logs },
    { row: temp },
    { row: humidity },
    { row: pressure },
    { row: gas },
    { rows: waterLevels },
    { rows: waterEvents },
    { metrics: sensorMetrics },
  ] = await Promise.all([
    getSystemLogs({ page: 0, rows: 20 }),
    getLatestEnvironmentReading('temperature_f'),
    getLatestEnvironmentReading('humidity_pct'),
    getLatestEnvironmentReading('pressure_hpa'),
    getLatestEnvironmentReading('iaq'),
    getWaterLevels(1),
    getRecentWateringEvents(5),
    getTankSensorHealthMetrics(7),
  ]);

  const fmtTime = (ts: Date | string | null | undefined) =>
    ts ? new Date(ts).toLocaleString() : 'unknown';
  const fmtNum = (n: number | null | undefined, d = 1) =>
    n != null ? Number(n).toFixed(d) : '—';

  const logLines = logs.length
    ? logs.map(l => `[${fmtTime(l.timestamp)}] [${l.log_type}] [${l.log_level}] ${l.source ?? '—'}: ${l.message}`).join('\n')
    : 'No recent logs.';

  const envLines = [
    `Temperature:   ${fmtNum(temp?.readings?.value)}°F`,
    `Humidity:      ${fmtNum(humidity?.readings?.value)}%`,
    `Pressure:      ${fmtNum(pressure?.readings?.value)} hPa`,
    `Air Quality:   ${fmtNum(gas?.readings?.value)} IAQ`,
  ].join('\n');

  const tank = waterLevels?.[0];
  const tankLine = tank
    ? `${fmtNum(tank.gallons)} gallons (${fmtNum(tank.pct_full)}% full) as of ${fmtTime(tank.timestamp)}`
    : 'No tank data.';

  const eventLines = waterEvents.length
    ? waterEvents.map(e => `  - ${fmtTime(e.timestamp)} | ${e.device_id} | ${e.status} | ${e.duration_ms != null ? e.duration_ms / 1000 + 's' : '—'}`).join('\n')
    : '  No recent watering events.';

  const stability = sensorMetrics
    ? `${sensorMetrics.total_count} readings | Mean: ${fmtNum(sensorMetrics.mean_value)} | Std Dev: ${fmtNum(sensorMetrics.std_dev)} | Range: ${fmtNum(sensorMetrics.min_value)}–${fmtNum(sensorMetrics.max_value)}`
    : 'No stability data.';

  return `You are Papus, a home automation AI assistant monitoring a smart home in Brooklyn. Analyze the system data below and give a warm, concise health summary covering environment conditions, water system status, sensor stability, and any errors or warnings worth noting. Keep it under 200 words and conversational.

--- SYSTEM LOGS (most recent 20) ---
${logLines}

--- ENVIRONMENT (latest readings) ---
${envLines}

--- WATER SYSTEM ---
Tank: ${tankLine}
Recent watering events:
${eventLines}

--- SENSOR STABILITY (7-day tank sensor) ---
${stability}`;
}

async function generateAndSaveSummary(): Promise<void> {
  try {
    const prompt = await buildPrompt();

    const response = await axios.post<{ message: { content: string } }>(
      process.env.OLLAMA_URL ?? 'http://ollama:11434/api/chat',
      { model: process.env.OLLAMA_MODEL ?? 'qwen3.5:9b', messages: [{ role: 'user', content: prompt }], stream: false }
    );

    const summary = response.data.message.content;
    await saveAiSummary({ summary });
    await appLog({ message: 'AI system summary generated', source: 'aiSummaryService', level: 'info' });
  } catch (err) {
    await appLog({ message: err instanceof Error ? err : new Error(String(err)), source: 'aiSummaryService', level: 'error' });
  }
}

export function startHourlySummary(): void {
  generateAndSaveSummary();
  setInterval(generateAndSaveSummary, 60 * 60 * 1000);
}
