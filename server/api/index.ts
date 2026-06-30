import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import si from 'systeminformation';
import axios from 'axios';
import { ollamaChat } from './ollama';
import { runChatTurn, buildSystemPrompt, summarizeSessionAsync } from './chatContext';
import { getCoverage, generateQuestions, processAnswers } from './homeKnowledgeOnboarding';
import { publishWaterCommand, publishLearnFrame, visionListeners, serviceStatus } from '../pubsub/mqttService';
import { startHourlySummary } from '../aiSummaries/aiSummaryService';
import { authMiddleware, ADMIN_EMAILS } from './auth';
import SHARED from '../../shared/plant_config.json';
import {
  getWaterHistory,
  appendWaterHistory,
  getWaterLevels,
  getDevices,
  getRoomsWithDevices,
  getLatestEnvironmentReading,
  apiLog,
  appLog,
  getTankSensorHealthMetrics,
  getDailyReadingStandardDeviation,
  getPhotoReactions,
  upsertPhotoReaction,
  removePhotoReaction,
  getSystemLogs,
  getLatestAiSummary,
  getLatestTankReadingsPerDevice,
  getLatestWaterEventPerDevice,
  getUserDisplayName,
  getAllDisplayNames,
  getDevicesWithStatus,
  createDevice,
  getDeviceConfig,
  updateDeviceConfig,
  createChatSession,
  getChatSession,
  getChatMessages,
  getAllHomeKnowledge,
  insertHomeKnowledge,
  updateHomeKnowledge,
  deleteHomeKnowledge,
  getVisionPeople,
  upsertVisionPerson,
  getServiceStats,
  getDeviceHealthStats,
  insertChatEval,
  updateChatEvalRating,
} from '../database/dao';

const app = express();
const REACTIONS = ['🥹', '😂', '🥰', '❤️'];
const PORT = process.env.PORT || 5000;
const UPLOAD_PATH = process.env.UPLOAD_PATH ?? '';

app.disable('etag');
app.use(express.json());

app.use((req, res, next) => {
  req.requestId =
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    crypto.randomUUID();
  req.startTime = Date.now();
  res.setHeader('x-request-id', req.requestId);
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    res.locals.responseBody = body;
    return originalJson(body);
  };
  res.on('finish', () => {
    apiLog({ req, res }).catch(() => {});
  });
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function roomLabel(name: string | null): string {
  const map: Record<string, string> = { living_room: 'LR', office: 'OF' };
  return map[name ?? ''] ?? (name ?? '??').slice(0, 2).toUpperCase();
}

const WEATHER_CODE_TEXT: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy rain showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

function weatherCodeToText(code: number): string {
  return WEATHER_CODE_TEXT[code] ?? 'Unknown';
}

// ── Public routes (before authMiddleware) ─────────────────────────────────────

app.get('/api/health', (_req, res) => {
  const now = Date.now();
  const staleMs = 30_000;
  const serviceAge = (d: Date | null) => d ? now - d.getTime() : null;
  const serviceState = (d: Date | null) =>
    d === null ? 'offline' : now - d.getTime() < staleMs ? 'ok' : 'stale';

  return res.status(200).json({
    api: 'ok',
    mqtt: serviceStatus.mqttConnected ? 'ok' : 'offline',
    visionWorker: {
      status: serviceState(serviceStatus.lastVisionResult),
      lastSeenMs: serviceAge(serviceStatus.lastVisionResult),
    },
    publisher: {
      status: serviceState(serviceStatus.lastPublisherFrame),
      lastSeenMs: serviceAge(serviceStatus.lastPublisherFrame),
    },
  });
});

app.get('/api/config', (_req, res) => {
  return res.status(200).json({
    reactions: REACTIONS,
    locationLabel: process.env.LOCATION_LABEL ?? 'Brooklyn, NY',
    aiPlaceholder:
      process.env.AI_PLACEHOLDER ?? 'RTX 2070 Online. How can I help?',
    mediaPathPrefix: process.env.MEDIA_URL_PREFIX ?? '/api/media',
  });
});

app.get('/api/display-stats', async (req, res) => {
  const token = req.query.token;
  if (!token || token !== process.env.DISPLAY_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const latitude = process.env.WEATHER_LAT ?? '40.6782';
    const longitude = process.env.WEATHER_LON ?? '-73.9442';
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit&timezone=America%2FNew_York`;

    const [
      weatherRes,
      lrTemp,
      offTemp,
      lrHum,
      offHum,
      lrIAQ,
      offIAQ,
      tankResult,
      waterResult,
    ] = await Promise.all([
      axios
        .get<{
          current_weather: { temperature: number; weathercode: number };
        }>(weatherUrl)
        .catch(() => null),
      getLatestEnvironmentReading('temperature_f', 'living_room'),
      getLatestEnvironmentReading('temperature_f', 'office'),
      getLatestEnvironmentReading('humidity_pct', 'living_room'),
      getLatestEnvironmentReading('humidity_pct', 'office'),
      getLatestEnvironmentReading('iaq', 'living_room'),
      getLatestEnvironmentReading('iaq', 'office'),
      getLatestTankReadingsPerDevice(),
      getLatestWaterEventPerDevice(),
    ]);

    const weather = weatherRes?.data?.current_weather;
    const outdoor = weather
      ? {
          temp_f: weather.temperature,
          description: weatherCodeToText(weather.weathercode),
        }
      : { temp_f: null, description: null };

    const lrTempVal = lrTemp.row?.readings?.value ?? null;
    const offTempVal = offTemp.row?.readings?.value ?? null;
    const lrHumVal = lrHum.row?.readings?.value ?? null;
    const offHumVal = offHum.row?.readings?.value ?? null;
    const lrIAQVal = lrIAQ.row?.readings?.value ?? null;
    const offIAQVal = offIAQ.row?.readings?.value ?? null;

    const humVals = [lrHumVal, offHumVal].filter(
      (v): v is number => v !== null
    );
    const iaqVals = [lrIAQVal, offIAQVal].filter(
      (v): v is number => v !== null
    );
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const now = Date.now();
    const tanks = (tankResult.rows ?? []).map((row) => ({
      label: roomLabel(row.room_name),
      gallons: parseFloat(String(row.gallons)) || 0,
      pct_full: parseInt(String(row.pct_full)) || 0,
    }));

    const last_water = (waterResult.rows ?? []).map((row) => ({
      label: roomLabel(row.room_name),
      seconds_ago: Math.floor((now - new Date(row.timestamp).getTime()) / 1000),
    }));

    return res.json({
      outdoor,
      living_room: { temp_f: lrTempVal },
      office: { temp_f: offTempVal },
      avg_humidity_pct: avg(humVals),
      avg_iaq: avg(iaqVals),
      tanks,
      last_water,
    });
  } catch (e) {
    await appLog({
      message: e instanceof Error ? e : new Error(String(e)),
      source: 'display-stats',
      level: 'error',
    });
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.use(authMiddleware);

// ── Multer setup ──────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: UPLOAD_PATH,
  filename: (_req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const UPLOAD_MAX_MB = parseInt(process.env.UPLOAD_MAX_MB ?? '20', 10);
const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 },
});

const enrollUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (/image\//i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are accepted'));
  },
});

// ── Protected routes ──────────────────────────────────────────────────────────

app.get('/api/users/display-names', async (req, res) => {
  const map = await getAllDisplayNames();
  return res.json(map);
});

app.get('/api/admin-status', async (req, res) => {
  const userEmail = req.userEmail ?? 'anonymous';
  const userId = userEmail.split('@')[0];
  const displayName = await getUserDisplayName(userEmail);
  return res.status(200).json({
    isAdmin: ADMIN_EMAILS.includes(userEmail),
    email: userEmail,
    displayName: displayName ?? userId,
  });
});

app.get('/api/whoami', (req, res) => {
  const email =
    (req.headers['cf-access-authenticated-user-email'] as string) ||
    'anonymous';
  return res.status(200).json({ email });
});

app.get('/api/can-water', async (req, res) => {
  const userEmail = req.userEmail ?? 'anonymous';
  const disabledReasons: string[] = [];
  const device_id = (req.query.device_id as string) || null;

  if (!ADMIN_EMAILS.includes(userEmail)) {
    disabledReasons.push('Admin access required');
  }

  try {
    const { rows: waterLevels, success } = await getWaterLevels(1, device_id);
    if (success && waterLevels.length > 0) {
      const gallons = waterLevels[0].gallons || 0;
      if (gallons < 3) {
        const deviceConfig = device_id ? await getDeviceConfig(device_id) : {};
        const tankCapacity = deviceConfig.tank_capacity_gallons ?? 30;
        disabledReasons.push(
          `Water level too low (${gallons.toFixed(1)}/${tankCapacity} gal)`
        );
      }
    }
  } catch (e) {
    await appLog({
      message: e instanceof Error ? e : new Error(String(e)),
      details: { context: 'checking water level' },
      source: 'can-water',
      level: 'warn',
    });
  }

  try {
    const { rows: history, success } = await getWaterHistory({
      device: device_id,
      page: 0,
      rows: 1,
      order: 'DESC',
    });
    if (success && history.length > 0) {
      const lastEvent = history[0];
      if (lastEvent.status === SHARED.water_status_complete) {
        const hoursSince =
          (Date.now() - new Date(lastEvent.timestamp).getTime()) /
          (1000 * 60 * 60);
        if (hoursSince < SHARED.pump_cycle_cooldown_hours) {
          const remaining = (
            SHARED.pump_cycle_cooldown_hours - hoursSince
          ).toFixed(1);
          disabledReasons.push(
            `Must wait ${remaining} more hours (${SHARED.pump_cycle_cooldown_hours}-hour minimum)`
          );
        }
      }
    }
  } catch (e) {
    await appLog({
      message: e instanceof Error ? e : new Error(String(e)),
      details: { context: 'checking watering history' },
      source: 'can-water',
      level: 'warn',
    });
  }

  return res
    .status(200)
    .json({ canWater: disabledReasons.length === 0, disabledReasons });
});

app.get('/api/devices', async (req, res) => {
  const { success, rows, dbError } = await getDevices();
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(200).json(rows);
});

app.get('/api/devices/status', async (req, res) => {
  const { success, rows, dbError } = await getDevicesWithStatus();
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(200).json(rows);
});

app.post('/api/admin/devices', async (req, res) => {
  const { device_id, friendly_name, device_type, room_name, has_ota } = req.body as {
    device_id: string;
    friendly_name: string;
    device_type: string;
    room_name: string;
    has_ota?: boolean;
  };

  if (!device_id || !friendly_name || !device_type || !room_name) {
    return res.status(400).json({ error: 'device_id, friendly_name, device_type, and room_name are required' });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(device_id)) {
    return res.status(400).json({ error: 'device_id must be alphanumeric with hyphens/underscores only' });
  }

  const { success, dbError } = await createDevice({ device_id, friendly_name, device_type, room_name, has_ota: has_ota ?? false });
  if (!success) {
    return res.status(400).json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(201).json({ success: true });
});

app.patch('/api/admin/devices/:id/config', async (req, res) => {
  const device_id = req.params.id;
  const body = req.body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  if ('tank_capacity_gallons' in body) {
    const v = body['tank_capacity_gallons'];
    if (typeof v !== 'number' || v <= 0 || v > 10000) {
      return res.status(400).json({ error: 'tank_capacity_gallons must be a positive number ≤ 10000' });
    }
    patch['tank_capacity_gallons'] = v;
  }

  if ('calibration_raw' in body) {
    const v = body['calibration_raw'];
    if (v !== null && (typeof v !== 'number' || v < 0)) {
      return res.status(400).json({ error: 'calibration_raw must be a non-negative number or null' });
    }
    patch['calibration_raw'] = v ?? null;
  }

  if ('calibration_gallons' in body) {
    const v = body['calibration_gallons'];
    if (v !== null && (typeof v !== 'number' || v < 0)) {
      return res.status(400).json({ error: 'calibration_gallons must be a non-negative number or null' });
    }
    patch['calibration_gallons'] = v ?? null;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No valid config keys provided' });
  }

  const { success, dbError } = await updateDeviceConfig(device_id, patch);
  if (!success) {
    return res.status(400).json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(200).json({ success: true });
});

app.get('/api/rooms', async (req, res) => {
  const { success, rows, dbError } = await getRoomsWithDevices();
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  res.status(200).json(rows);
});

app.get('/api/service-stats', async (_req, res) => {
  const result = await getServiceStats();
  return res.status(result.success ? 200 : 500).json(result);
});

app.get('/api/device-health-stats', async (_req, res) => {
  const { success, rows, dbError } = await getDeviceHealthStats();
  if (!success) return res.status(500).json({ error: dbError!.name, debugId: dbError!.debugId });
  return res.json(rows);
});

app.get('/api/stats', async (req, res) => {
  try {
    const [cpu, mem, temp] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
    ]);
    return res.status(200).json({
      cpu: Math.round(cpu.currentLoad),
      mem: Math.round((mem.active / mem.total) * 100),
      temp: temp.main ?? 'N/A',
    });
  } catch (e) {
    return res.status(400).json({ error: 'Could not fetch stats' });
  }
});

app.get('/api/weather', async (req, res) => {
  try {
    const latitude = process.env.WEATHER_LAT ?? '40.6782';
    const longitude = process.env.WEATHER_LON ?? '-73.9442';
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=fahrenheit&timezone=America%2FNew_York`;

    const response = await axios.get<{
      current_weather: {
        temperature: number;
        weathercode: number;
        time: string;
      };
    }>(apiUrl);
    const weather = response.data?.current_weather;
    if (!weather) throw new Error('Open-Meteo returned no current weather');

    return res.status(200).json({
      temp: weather.temperature,
      description: weatherCodeToText(weather.weathercode),
      time: weather.time,
    });
  } catch (e) {
    return res.status(400).json({ error: 'Could not fetch weather' });
  }
});

app.get('/api/environment/latest', async (req, res) => {
  const metric = (req.query.metric as string) || 'temperature_f';
  const room_name = (req.query.room_name as string) || null;
  try {
    const { success, row, dbError } = await getLatestEnvironmentReading(
      metric,
      room_name
    );
    if (!success) {
      return res
        .status(500)
        .json({ error: dbError!.name, debugId: dbError!.debugId });
    }
    if (!row) {
      return res.status(404).json({ error: 'No readings found' });
    }
    return res.status(200).json({
      device_id: row.device_id,
      room_name: row.room_name,
      readings: row.readings,
      timestamp: row.timestamp,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/watering-history', async (req, res) => {
  const { rows, page } = req.query;
  const {
    success,
    rows: waterHistory,
    dbError,
  } = await getWaterHistory({
    device: (req.query.device_id as string) || null,
    rows: rows as string,
    page: page as string,
    order: 'DESC',
  });
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(200).json(waterHistory);
});

app.get('/api/water-level', async (req, res) => {
  const { rows, device_id } = req.query;
  const {
    success,
    rows: latestWaterLevel,
    dbError,
  } = await getWaterLevels(rows as string, (device_id as string) || null);
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  if (!latestWaterLevel.length) {
    return res.status(404).json({ error: 'No water level data found' });
  }
  return res.status(200).json({
    gallons: latestWaterLevel[0].gallons,
    timestamp: latestWaterLevel[0].timestamp,
  });
});

app.get('/api/stats/sensor-stability', async (req, res) => {
  const { device_id } = req.query;
  const [stabilityResult, stdDevResult] = await Promise.all([
    getTankSensorHealthMetrics(7, (device_id as string) || null),
    getDailyReadingStandardDeviation(7, (device_id as string) || null),
  ]);

  if (!stabilityResult.success || !stabilityResult.metrics) {
    const status = stabilityResult.success ? 404 : 400;
    const body = stabilityResult.dbError
      ? {
          error: stabilityResult.dbError.name,
          debugId: stabilityResult.dbError.debugId,
        }
      : { error: 'No sensor data found' };
    return res.status(status).json(body);
  }
  if (!stdDevResult.success || !stdDevResult.dailyStdDev) {
    return res.status(400).json({
      error: stdDevResult.dbError!.name,
      debugId: stdDevResult.dbError!.debugId,
    });
  }
  return res.status(200).json({
    metrics: stabilityResult.metrics,
    dailyStdDev: stdDevResult.dailyStdDev,
  });
});

app.post('/api/admin/water', async (req, res) => {
  const { device_id, duration_seconds, action } = req.body as {
    device_id: string;
    duration_seconds: number;
    action: string;
  };
  const { rows, success, dbError } = await getWaterHistory({
    device: device_id,
    page: 0,
    rows: 1,
    order: 'DESC',
  });
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }

  try {
    const mostRecentWaterEvent = rows[0];
    const mostRecentWaterDate = mostRecentWaterEvent?.timestamp;
    if (
      mostRecentWaterDate &&
      Date.now() - new Date(mostRecentWaterDate).getTime() <
        1000 * 60 * 60 * 6 &&
      mostRecentWaterEvent.status === SHARED.water_status_complete
    ) {
      return res.status(400).json({ error: 'Too soon to water' });
    }

    const {
      success: appendSuccess,
      dbError: appendError,
      eventId,
    } = await appendWaterHistory({
      deviceId: device_id,
      durationMs: duration_seconds * 1000,
      action,
      userEmail: req.userEmail ?? 'unknown',
    });
    if (!appendSuccess || eventId === null) {
      return res
        .status(400)
        .json({ error: appendError!.name, debugId: appendError!.debugId });
    }

    const sent = await publishWaterCommand({
      event_id: eventId,
      device_id,
      action,
      duration_ms: duration_seconds * 1000,
    });
    res.status(202).json({
      message: sent ? 'Command sent to node' : 'Broker offline, command queued',
      eventId,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Failed to process water request' });
  }
});

app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  return res.redirect('/photo-gallery.html');
});

// ── TTS ───────────────────────────────────────────────────────────────────────

const KOKORO_URL = process.env.KOKORO_URL || 'http://kokoro:8880';
const TTS_VOICE  = process.env.TTS_VOICE  || 'af_bella';

app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body as { text?: string; voice?: string };
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  try {
    const ttsRes = await axios.post(
      `${KOKORO_URL}/v1/audio/speech`,
      { model: 'kokoro', input: text.trim(), voice: voice || TTS_VOICE, response_format: 'mp3', speed: 1.0 },
      { responseType: 'arraybuffer', timeout: 20000 }
    );
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(ttsRes.data as ArrayBuffer));
  } catch {
    res.status(503).json({ error: 'TTS service unavailable' });
  }
});

// ── Chat session endpoints ─────────────────────────────────────────────────────

app.post('/api/chat/session', async (req, res) => {
  const { sessionKey, prevSessionKey } = req.body as {
    sessionKey: string;
    prevSessionKey?: string;
  };
  if (!sessionKey || typeof sessionKey !== 'string') {
    return res.status(400).json({ error: 'sessionKey required' });
  }
  await createChatSession(sessionKey);
  if (prevSessionKey && typeof prevSessionKey === 'string') {
    summarizeSessionAsync(prevSessionKey);
  }
  res.json({ ok: true });
});

app.get('/api/chat/session/:key', async (req, res) => {
  const { key } = req.params;
  const [session, messages] = await Promise.all([
    getChatSession(key),
    getChatMessages(key),
  ]);
  if (!session.row) return res.status(404).json({ error: 'session not found' });
  res.json({
    session: session.row,
    messages: messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
  });
});

app.post('/api/chat', async (req, res) => {
  const { sessionKey, message, personName } = req.body as {
    sessionKey?: string;
    message: string;
    personName?: string | null;
  };

  // Legacy path: no sessionKey, build a one-shot context from the old system param
  if (!sessionKey) {
    const { system } = req.body as { system?: string };
    const msgs: Array<{ role: string; content: string }> = [];
    if (system) msgs.push({ role: 'system', content: system });
    msgs.push({ role: 'user', content: message });
    try {
      const reply = await ollamaChat(msgs);
      return res.json({ reply });
    } catch {
      return res.status(400).json({ error: 'The AI is currently offline.' });
    }
  }

  try {
    const t0 = Date.now();
    const reply = await runChatTurn(sessionKey, message, personName ?? null);
    const responseTimeMs = Date.now() - t0;
    const evalResult = await insertChatEval(sessionKey, message, reply, responseTimeMs);
    res.json({ reply, evalId: evalResult.id });
  } catch {
    return res.status(400).json({ error: 'The AI is currently offline.' });
  }
});

app.patch('/api/chat/eval/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { field, value } = req.body as { field: string; value: unknown };
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  if (field !== 'quality' && field !== 'correctness') {
    return res.status(400).json({ error: 'field must be quality or correctness' });
  }
  if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be boolean' });
  const result = await updateChatEvalRating(id, field, value);
  if (!result.success) return res.status(500).json({ error: 'db error' });
  res.json({ ok: true });
});

app.get('/api/chat/context', async (req, res) => {
  const personName = (req.query.person as string) || null;
  try {
    const systemPrompt = await buildSystemPrompt(personName);
    res.json({ systemPrompt });
  } catch {
    res.status(500).json({ error: 'failed to build context' });
  }
});

// ── Home knowledge endpoints ───────────────────────────────────────────────────

app.get('/api/home-knowledge/coverage', async (_req, res) => {
  try {
    res.json(await getCoverage());
  } catch {
    res.status(500).json({ error: 'failed to compute coverage' });
  }
});

app.post('/api/home-knowledge/questions', async (_req, res) => {
  try {
    const questions = await generateQuestions();
    res.json({ questions });
  } catch {
    res.status(500).json({ error: 'failed to generate questions' });
  }
});

app.post('/api/home-knowledge/answers', async (req, res) => {
  const { pairs } = req.body as {
    pairs: Array<{ question: string; subject: string; category: string; answer: string }>;
  };
  if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs array required' });
  const filled = pairs.filter((p) => p.answer?.trim());
  if (!filled.length) return res.json({ saved: 0, facts: [] });
  try {
    const result = await processAnswers(filled);
    res.json(result);
  } catch {
    res.status(500).json({ error: 'failed to process answers' });
  }
});

app.get('/api/home-knowledge', async (_req, res) => {
  const rows = await getAllHomeKnowledge();
  res.json(rows);
});

app.post('/api/home-knowledge', async (req, res) => {
  const { subject, category, fact } = req.body as {
    subject: string;
    category: string;
    fact: string;
  };
  if (!subject || !category || !fact) {
    return res.status(400).json({ error: 'subject, category, and fact are required' });
  }
  const result = await insertHomeKnowledge(subject, category, fact);
  if (!result.success) return res.status(500).json({ error: 'db error' });
  res.json({ id: result.id });
});

app.put('/api/home-knowledge/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { subject, category, fact } = req.body as {
    subject: string;
    category: string;
    fact: string;
  };
  if (!subject || !category || !fact) {
    return res.status(400).json({ error: 'subject, category, and fact are required' });
  }
  const result = await updateHomeKnowledge(id, subject, category, fact);
  if (!result.success) return res.status(500).json({ error: 'db error' });
  res.json({ ok: true });
});

app.delete('/api/home-knowledge/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
  const result = await deleteHomeKnowledge(id);
  if (!result.success) return res.status(500).json({ error: 'db error' });
  res.json({ ok: true });
});

app.get('/api/list-images', (req, res) => {
  const limit = req.query.limit
    ? parseInt(req.query.limit as string)
    : undefined;
  fs.readdir(UPLOAD_PATH, (err, files) => {
    if (err) {
      return res.status(500).json([]);
    }
    let images = files.filter((f) => /\.(jpg|jpeg|png|gif)$/i.test(f));
    if (limit) images = images.slice(0, limit);
    return res.status(200).json(images);
  });
});

app.get('/api/media/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_PATH, filename);
  res.sendFile(filepath, { root: '/' });
});

app.get('/api/photo-reactions', async (req, res) => {
  const file = req.query.file as string;
  if (!file) {
    return res.status(400).json({ error: 'file required' });
  }

  const { success, rows } = await getPhotoReactions(file);
  if (!success) {
    return res.status(500).json({ error: 'db error' });
  }

  const counts: Record<string, number> = {};
  const details: Record<string, string[]> = {};
  rows.forEach((r) => {
    counts[r.reaction] = parseInt(String(r.count || 0), 10);
    details[r.reaction] = r.users || [];
  });
  return res.json({ counts, details });
});

app.post('/api/photo-reactions', async (req, res) => {
  const { file, reaction } = req.body as { file: string; reaction: string };
  const userEmail = req.userEmail ?? 'anonymous';

  if (!file || !reaction) {
    return res.status(400).json({ error: 'file and reaction required' });
  }
  if (!REACTIONS.includes(reaction)) {
    return res.status(400).json({ error: 'invalid reaction' });
  }
  if (!userEmail || userEmail === 'anonymous') {
    return res.status(401).json({ error: 'authentication required' });
  }

  const existing = await getPhotoReactions(file);
  if (existing.success) {
    const userHas = existing.rows.find(
      (r) => (r.users || []).includes(userEmail) && r.reaction === reaction
    );
    if (userHas) {
      await removePhotoReaction({ photoFilename: file, userEmail });
      const { rows: refreshed } = await getPhotoReactions(file);
      const counts: Record<string, number> = {};
      refreshed.forEach(
        (r) => (counts[r.reaction] = parseInt(String(r.count || 0), 10))
      );
      return res.json({ success: true, counts });
    }
  }

  const { success, dbError } = await upsertPhotoReaction({
    photoFilename: file,
    userEmail,
    reaction,
  });
  if (!success) {
    return res
      .status(500)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }

  const { rows: refreshed } = await getPhotoReactions(file);
  const counts: Record<string, number> = {};
  refreshed.forEach(
    (r) => (counts[r.reaction] = parseInt(String(r.count || 0), 10))
  );
  return res.status(200).json({ success: true, counts });
});

app.delete('/api/photo-reactions', async (req, res) => {
  const { file } = req.body as { file: string };
  const userEmail = req.userEmail ?? 'anonymous';

  if (!file) {
    return res.status(400).json({ error: 'file required' });
  }
  if (!userEmail || userEmail === 'anonymous') {
    return res.status(401).json({ error: 'authentication required' });
  }

  const { success, dbError } = await removePhotoReaction({
    photoFilename: file,
    userEmail,
  });
  if (!success) {
    return res
      .status(500)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }

  const { rows: refreshed } = await getPhotoReactions(file);
  const counts: Record<string, number> = {};
  refreshed.forEach(
    (r) => (counts[r.reaction] = parseInt(String(r.count || 0), 10))
  );
  return res.status(200).json({ success: true, counts });
});

app.get('/api/vision/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  visionListeners.add(res);
  req.on('close', () => visionListeners.delete(res));
});

app.get('/api/ai-summary', async (req, res) => {
  const { success, row } = await getLatestAiSummary();
  if (!success || !row) {
    return res.status(404).json({ error: 'No summary available yet' });
  }
  return res.json({ summary: row.summary, timestamp: row.timestamp });
});

app.get('/api/system-logs', async (req, res) => {
  const { log_type, log_level, page, rows } = req.query;
  const {
    success,
    rows: logs,
    dbError,
  } = await getSystemLogs({
    log_type: (log_type as string) || null,
    log_level: (log_level as string) || null,
    page: (page as string) || 0,
    rows: (rows as string) || 50,
  });
  if (!success) {
    return res
      .status(400)
      .json({ error: dbError!.name, debugId: dbError!.debugId });
  }
  return res.status(200).json(logs);
});

// ── Vision people endpoints ───────────────────────────────────────────────────

app.get('/api/vision/people', async (_req, res) => {
  const people = await getVisionPeople();
  res.json(people);
});

app.post('/api/vision/enroll', enrollUpload.array('photos', 20), async (req, res) => {
  const name = (req.body as { name?: string }).name?.trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) return res.status(400).json({ error: 'at least one photo is required' });

  if (!serviceStatus.mqttConnected) {
    return res.status(503).json({ error: 'MQTT broker is offline' });
  }

  let published = 0;
  for (const file of files) {
    const b64 = file.buffer.toString('base64');
    if (publishLearnFrame(name, b64)) published++;
  }

  await upsertVisionPerson(name, published);
  res.json({ enrolled: published, total: files.length });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  startHourlySummary();
});
