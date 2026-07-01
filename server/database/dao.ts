import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { db } from './db';
import { DbError, createDbError } from './errors';
import type {
  WateringEvent,
  TankReading,
  TankReadingWithRoom,
  WaterEventWithRoom,
  Device,
  DeviceConfig,
  RoomWithDevices,
  EnvironmentReading,
  AiSummary,
  PhotoReactionRow,
  SystemLog,
  SensorHealthMetrics,
  DailyStdDev,
  DeviceWithStatus,
  ChatSession,
  ChatMessage,
  HomeKnowledge,
  VisionPerson,
} from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function logDbError(raw: unknown, source: string): Promise<DbError> {
  const dbError = createDbError(raw, source);
  await appLog({
    message: raw instanceof Error ? raw : new Error(String(raw)),
    details: dbError.details,
    source,
    level: 'error',
  });
  return dbError;
}

async function tryRows<T>(
  source: string,
  fn: () => Promise<T[]>
): Promise<{ success: boolean; dbError?: DbError; rows: T[] }> {
  try {
    return { success: true, rows: await fn() };
  } catch (err) {
    return { success: false, dbError: await logDbError(err, source), rows: [] };
  }
}

async function tryRow<T>(
  source: string,
  fn: () => Promise<T | undefined>
): Promise<{ success: boolean; dbError?: DbError; row: T | null }> {
  try {
    return { success: true, row: (await fn()) ?? null };
  } catch (err) {
    return { success: false, dbError: await logDbError(err, source), row: null };
  }
}

async function tryMutate(
  source: string,
  fn: () => Promise<void>
): Promise<{ success: boolean; dbError?: DbError }> {
  try {
    await fn();
    return { success: true };
  } catch (err) {
    return { success: false, dbError: await logDbError(err, source) };
  }
}

// ── Water history ─────────────────────────────────────────────────────────────

export async function getWaterHistory({
  device,
  page,
  rows,
  order,
}: {
  device: string | null;
  page: number | string;
  rows: number | string;
  order?: string;
}): Promise<{ success: boolean; dbError?: DbError; rows: WateringEvent[] }> {
  if (device === null) return { success: true, rows: [] };

  const limit = parseInt(String(rows)) || 5;
  const offset = page ? parseInt(String(page)) * limit : 0;
  const dir = order?.toUpperCase() === 'DESC' ? ('desc' as const) : ('asc' as const);

  return tryRows('getWaterHistory', () =>
    db
      .selectFrom('watering_events')
      .selectAll()
      .where('device_id', '=', device)
      .orderBy('timestamp', dir)
      .offset(offset)
      .limit(limit)
      .execute()
  );
}

export async function appendWaterHistory({
  deviceId,
  durationMs,
  action,
  userEmail,
}: {
  deviceId: string;
  durationMs: number;
  action: string;
  userEmail: string;
}): Promise<{ success: boolean; dbError?: DbError; eventId: number | null }> {
  try {
    const row = await db
      .insertInto('watering_events')
      .values({ device_id: deviceId, status: 'requested', duration_ms: durationMs, action, started_by: userEmail })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { success: true, eventId: row.id };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'appendWaterHistory'), eventId: null };
  }
}

export async function updateWaterEvent({
  event_id,
  duration,
  status,
}: {
  event_id: number;
  duration: number;
  status: string;
}): Promise<{ success: boolean; dbError?: DbError; updatedCount: number }> {
  try {
    const result = await db
      .updateTable('watering_events')
      .set({ status, duration_ms: duration })
      .where('id', '=', event_id)
      .executeTakeFirst();
    return { success: true, updatedCount: Number(result.numUpdatedRows) };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'updateWaterEvent'), updatedCount: 0 };
  }
}

export async function getWaterLevels(
  rows: number | string = 1,
  device_id: string | null = null
): Promise<{ success: boolean; dbError?: DbError; rows: TankReading[] }> {
  const limit = parseInt(String(rows)) || 1;

  return tryRows('getWaterLevels', () => {
    let q = db.selectFrom('tank_readings').selectAll().orderBy('timestamp', 'desc').limit(limit);
    if (device_id) q = q.where('device_id', '=', device_id);
    return q.execute();
  });
}

export async function appendWaterLevel({
  device_id,
  gallons,
  raw_value,
  percent_full,
}: {
  device_id: string;
  gallons: number;
  raw_value: number;
  percent_full: number;
}): Promise<{ success: boolean; dbError?: DbError }> {
  try {
    await db
      .insertInto('tank_readings')
      .values({ device_id, gallons, raw_value, pct_full: Math.round(percent_full || 0) })
      .execute();
    return { success: true };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'appendWaterLevel') };
  }
}

export async function getLatestTankReadingsPerDevice(): Promise<{
  success: boolean;
  rows: TankReadingWithRoom[];
}> {
  return tryRows('getLatestTankReadingsPerDevice', async () => {
    const result = await sql<TankReadingWithRoom>`
      SELECT DISTINCT ON (tr.device_id)
        tr.device_id, tr.gallons, tr.pct_full, tr.timestamp,
        r.name AS room_name
      FROM tank_readings tr
      LEFT JOIN devices d ON d.device_id = tr.device_id
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY tr.device_id, tr.timestamp DESC
    `.execute(db);
    return result.rows;
  });
}

export async function getLatestWaterEventPerDevice(): Promise<{
  success: boolean;
  rows: WaterEventWithRoom[];
}> {
  return tryRows('getLatestWaterEventPerDevice', async () => {
    const result = await sql<WaterEventWithRoom>`
      SELECT DISTINCT ON (we.device_id)
        we.device_id, we.timestamp, we.status,
        r.name AS room_name
      FROM watering_events we
      LEFT JOIN devices d ON d.device_id = we.device_id
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE we.status = 'complete'
      ORDER BY we.device_id, we.timestamp DESC
    `.execute(db);
    return result.rows;
  });
}

export async function getRecentWateringEvents(
  limit = 5
): Promise<{ success: boolean; rows: WateringEvent[] }> {
  return tryRows('getRecentWateringEvents', () =>
    db.selectFrom('watering_events').selectAll().orderBy('timestamp', 'desc').limit(limit).execute()
  );
}

// ── Tank sensor metrics ───────────────────────────────────────────────────────

export async function getTankSensorHealthMetrics(
  days = 7,
  device_id: string | null = null
): Promise<{ success: boolean; dbError?: DbError; metrics?: SensorHealthMetrics }> {
  const deviceFilter = device_id ? sql`AND device_id = ${device_id}` : sql``;
  try {
    const result = await sql<SensorHealthMetrics>`
      WITH filtered AS (
          SELECT raw_value
          FROM tank_readings
          WHERE timestamp >= NOW() - (${days} || ' days')::interval ${deviceFilter}
      ),
      stats AS (
          SELECT
              COUNT(*) AS total_count,
              MIN(raw_value) AS min_value,
              MAX(raw_value) AS max_value,
              AVG(raw_value) AS mean_value,
              STDDEV_POP(raw_value) AS std_dev,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY raw_value) AS median_value
          FROM filtered
      ),
      mode_calc AS (
          SELECT raw_value AS mode_value
          FROM filtered
          GROUP BY raw_value
          ORDER BY COUNT(*) DESC, raw_value
          LIMIT 1
      )
      SELECT s.total_count, s.min_value, s.max_value, s.mean_value,
             s.std_dev, s.median_value, m.mode_value
      FROM stats s
      CROSS JOIN mode_calc m
    `.execute(db);
    return { success: true, metrics: result.rows[0] };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'getTankSensorHealthMetrics') };
  }
}

export async function getDailyReadingStandardDeviation(
  days = 7,
  device_id: string | null = null
): Promise<{ success: boolean; dbError?: DbError; dailyStdDev: DailyStdDev[] }> {
  const deviceFilter = device_id ? sql`AND device_id = ${device_id}` : sql``;
  try {
    const result = await sql<DailyStdDev>`
      SELECT
          DATE_TRUNC('day', timestamp) AS day,
          STDDEV_POP(raw_value) AS daily_stddev
      FROM tank_readings
      WHERE timestamp >= NOW() - (${days} || ' days')::interval ${deviceFilter}
      GROUP BY day
      ORDER BY day ASC
    `.execute(db);
    return { success: true, dailyStdDev: result.rows };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'getDailyReadingStandardDeviation'), dailyStdDev: [] };
  }
}

// ── Devices & rooms ───────────────────────────────────────────────────────────

export async function getDevices({
  page = 0,
  rows = 20,
  order = 'ASC',
}: { page?: number; rows?: number; order?: string } = {}): Promise<{
  success: boolean;
  dbError?: DbError;
  rows: Device[];
}> {
  const limit = parseInt(String(rows)) || 20;
  const offset = page ? parseInt(String(page)) * limit : 0;
  const dir = order?.toUpperCase() === 'DESC' ? ('desc' as const) : ('asc' as const);

  return tryRows('getDevices', () =>
    db
      .selectFrom('devices')
      .selectAll()
      .orderBy('device_id', dir)
      .offset(offset)
      .limit(limit)
      .execute()
  );
}

export async function getRoomsWithDevices(): Promise<{
  success: boolean;
  dbError?: DbError;
  rows: RoomWithDevices[];
}> {
  return tryRows('getRoomsWithDevices', async () => {
    const result = await sql<RoomWithDevices>`
      SELECT r.id, r.name, r.display_name,
        COALESCE(
          json_agg(json_build_object('device_id', d.device_id, 'friendly_name', d.friendly_name))
          FILTER (WHERE d.device_id IS NOT NULL AND d.device_type = 'pump'),
          '[]'::json
        ) AS devices
      FROM rooms r
      LEFT JOIN devices d ON d.room_id = r.id
      GROUP BY r.id, r.name, r.display_name
      ORDER BY r.display_name
    `.execute(db);
    return result.rows;
  });
}

export async function getRoomIdForDevice(device_id: string): Promise<number | null> {
  try {
    const row = await db
      .selectFrom('devices')
      .select('room_id')
      .where('device_id', '=', device_id)
      .executeTakeFirst();
    return row?.room_id ?? null;
  } catch {
    return null;
  }
}

// ── Environment readings ──────────────────────────────────────────────────────

export async function appendEnvironmentReading({
  device_id,
  room_id = null,
  readings = {},
}: {
  device_id: string;
  room_id?: number | null;
  readings?: Record<string, unknown>;
}): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('appendEnvironmentReading', () =>
    db
      .insertInto('environment_readings')
      .values({ device_id, room_id, readings: JSON.stringify(readings) })
      .execute()
      .then(() => undefined)
  );
}

export async function getLatestEnvironmentReading(
  metric: string,
  room_name: string | null = null
): Promise<{ success: boolean; dbError?: DbError; row: EnvironmentReading | null }> {
  return tryRow('getLatestEnvironmentReading', async () => {
    const roomFilter = room_name ? sql`AND r.name = ${room_name}` : sql``;
    const result = await sql<EnvironmentReading>`
      SELECT er.device_id, r.name AS room_name, er.readings, er.timestamp
      FROM environment_readings er
      LEFT JOIN rooms r ON r.id = er.room_id
      WHERE er.readings->>'metric' = ${metric} ${roomFilter}
      ORDER BY er.timestamp DESC
      LIMIT 1
    `.execute(db);
    return result.rows[0];
  });
}

// ── Logging ───────────────────────────────────────────────────────────────────

// High-frequency polling endpoints that produce no signal — suppress from api_logs.
// Errors (4xx/5xx) on these paths are still logged regardless.
const API_LOG_SUPPRESSED_PATHS = new Set([
  '/api/stats',
  '/api/can-water',
  '/api/health',
  '/api/config',
  '/api/devices/status',
  '/api/stats/sensor-stability',
  '/api/weather',
  '/api/ai-summary',
  '/api/display-stats',
  '/api/service-stats',
  '/api/device-health-stats',
]);

const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS ?? '30', 10);

async function pruneOldLogs(): Promise<void> {
  await sql`DELETE FROM api_logs  WHERE timestamp  < NOW() - INTERVAL '1 day' * ${sql.val(LOG_RETENTION_DAYS)}`.execute(db);
  await sql`DELETE FROM app_logs  WHERE timestamp  < NOW() - INTERVAL '1 day' * ${sql.val(LOG_RETENTION_DAYS)}`.execute(db);
  await sql`DELETE FROM device_logs WHERE timestamp < NOW() - INTERVAL '1 day' * ${sql.val(LOG_RETENTION_DAYS)}`.execute(db);
}

// Prune once on startup, then every 24 hours
pruneOldLogs().catch(() => {});
setInterval(() => pruneOldLogs().catch(() => {}), 24 * 60 * 60 * 1000);

async function appendApiLog({ req, res }: { req: Request; res: Response }): Promise<void> {
  const path = req.path ?? req.originalUrl;
  const status = res.statusCode ?? 200;

  // Suppress noisy polling paths unless they errored
  if (API_LOG_SUPPRESSED_PATHS.has(path) && status < 400) return;

  const body = res.locals.responseBody as Record<string, unknown> | undefined;
  await db
    .insertInto('api_logs')
    .values({
      path,
      request_body: req.body != null ? JSON.stringify(req.body) : null,
      status_code: status,
      response_body: body != null ? JSON.stringify(body) : null,
      response_time_ms: req.startTime ? Date.now() - req.startTime : null,
    })
    .execute();
}

async function appendAppLog({
  level = 'info',
  message,
  details = null,
  source = null,
}: {
  level?: string;
  message: string;
  details?: unknown;
  source?: string | null;
}): Promise<void> {
  if (!message) return;

  const safeDetails =
    details === null || details === undefined
      ? null
      : typeof details === 'string'
        ? details
        : JSON.stringify(details);

  try {
    await db
      .insertInto('app_logs')
      .values({ log_level: level, message, details: safeDetails, source })
      .execute();
  } catch (err) {
    console.log('Failed to log app message:', err);
  }
}

export async function appLog({
  message,
  details = null,
  source = null,
  level = 'info',
}: {
  message: string | Error;
  details?: unknown;
  source?: string | null;
  level?: string;
}): Promise<void> {
  try {
    if (!message) return;

    let safeMessage: string;
    let safeDetails: unknown = details;

    if (message instanceof Error) {
      safeDetails = { ...(typeof details === 'object' && details !== null ? details : {}), stack: message.stack };
      safeMessage = message.message;
    } else {
      safeMessage = message;
    }

    await appendAppLog({ level, message: safeMessage, details: safeDetails, source });
  } catch (err) {
    console.log('Failed to write app log:', err);
  }
}

export async function apiLog({ req, res }: { req: Request; res: Response }): Promise<void> {
  try {
    await appendApiLog({ req, res });
  } catch (err) {
    console.log('Failed to log API request:', err);
  }
}


export async function appendDeviceLog({
  device_id,
  log_level,
  message,
  details = null,
}: {
  device_id: string;
  log_level: string;
  message: string;
  details?: unknown;
}): Promise<void> {
  if (!device_id || !message) return;

  const safeDetails =
    details === null || details === undefined
      ? null
      : typeof details === 'string'
        ? details
        : JSON.stringify(details);

  try {
    await db
      .insertInto('device_logs')
      .values({ device_id, log_level, message, details: safeDetails })
      .execute();
  } catch (err) {
    console.log('Failed to write device log:', err);
  }
}

export async function getSystemLogs({
  log_type = null,
  log_level = null,
  page = 0,
  rows = 50,
}: {
  log_type?: string | null;
  log_level?: string | null;
  page?: number | string;
  rows?: number | string;
} = {}): Promise<{ success: boolean; rows: SystemLog[]; dbError?: DbError }> {
  const limit = parseInt(String(rows)) || 50;
  const offset = parseInt(String(page)) * limit;

  return tryRows('getSystemLogs', async () => {
    const result = await sql<SystemLog>`
      SELECT * FROM (
        SELECT 'app'    AS log_type, log_level, message, source, details, timestamp FROM app_logs
        UNION ALL
        SELECT 'device' AS log_type, dl.log_level, dl.message,
               COALESCE(d.friendly_name, dl.device_id) AS source, dl.details, dl.timestamp
        FROM device_logs dl
        LEFT JOIN devices d ON d.device_id = dl.device_id
        UNION ALL
        SELECT 'api' AS log_type,
               CASE WHEN status_code >= 500 THEN 'error'
                    WHEN status_code >= 400 THEN 'warn'
                    ELSE 'info' END AS log_level,
               path AS message,
               'api' AS source,
               jsonb_build_object(
                 'status_code', status_code,
                 'response_time_ms', response_time_ms,
                 'request_body', request_body,
                 'response_body', response_body
               ) AS details,
               timestamp
        FROM api_logs
      ) AS logs
      WHERE (${log_type}::text IS NULL OR log_type = ${log_type})
        AND (${log_level}::text IS NULL OR log_level = ${log_level})
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `.execute(db);
    return result.rows;
  });
}

// ── AI summaries ──────────────────────────────────────────────────────────────

export type DeviceHealthRow = {
  device_id: string;
  friendly_name: string | null;
  device_type: string | null;
  room_display_name: string | null;
  env_readings_7d: number;
  tank_readings_7d: number;
  watering_total_7d: number;
  watering_complete_7d: number;
  watering_errors_7d: number;
  device_log_errors_7d: number;
};

export async function getDeviceHealthStats(): Promise<{ success: boolean; dbError?: DbError; rows: DeviceHealthRow[] }> {
  return tryRows('getDeviceHealthStats', async () => {
    const result = await sql<DeviceHealthRow>`
      SELECT
        d.device_id,
        d.friendly_name,
        d.device_type,
        r.display_name AS room_display_name,
        COALESCE(env.cnt, 0)::int          AS env_readings_7d,
        COALESCE(tank.cnt, 0)::int         AS tank_readings_7d,
        COALESCE(water.total, 0)::int      AS watering_total_7d,
        COALESCE(water.complete, 0)::int   AS watering_complete_7d,
        COALESCE(water.errors, 0)::int     AS watering_errors_7d,
        COALESCE(dlogs.errors, 0)::int     AS device_log_errors_7d
      FROM devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      LEFT JOIN (
        SELECT device_id, COUNT(*) AS cnt
        FROM environment_readings
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY device_id
      ) env ON env.device_id = d.device_id
      LEFT JOIN (
        SELECT device_id, COUNT(*) AS cnt
        FROM tank_readings
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY device_id
      ) tank ON tank.device_id = d.device_id
      LEFT JOIN (
        SELECT
          device_id,
          COUNT(*)                                                    AS total,
          COUNT(*) FILTER (WHERE status = 'complete')                 AS complete,
          COUNT(*) FILTER (WHERE status NOT IN ('complete', 'requested', 'BLOCKED_LOW_WATER')) AS errors
        FROM watering_events
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY device_id
      ) water ON water.device_id = d.device_id
      LEFT JOIN (
        SELECT device_id, COUNT(*) AS errors
        FROM device_logs
        WHERE log_level = 'error' AND timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY device_id
      ) dlogs ON dlogs.device_id = d.device_id
      ORDER BY r.display_name NULLS LAST, d.friendly_name
    `.execute(db);
    return result.rows;
  });
}

export async function getServiceStats(): Promise<{
  success: boolean;
  api: { total: number; by_bucket: Array<{ bucket: string; count: number }> };
  mqtt: { total: number; errors: number };
  ai: { total: number; errors: number };
}> {
  const empty = { api: { total: 0, by_bucket: [] as Array<{ bucket: string; count: number }> }, mqtt: { total: 0, errors: 0 }, ai: { total: 0, errors: 0 } };
  try {
    const [apiRes, mqttTotalRes, mqttErrRes, aiRes] = await Promise.all([
      sql<{ bucket: string; count: number }>`
        SELECT
          CASE
            WHEN status_code >= 500 THEN '5xx'
            WHEN status_code >= 400 THEN '4xx'
            WHEN status_code >= 300 THEN '3xx'
            ELSE '2xx'
          END AS bucket,
          COUNT(*)::int AS count
        FROM api_logs
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY bucket
        ORDER BY bucket
      `.execute(db),
      sql<{ total: number }>`
        SELECT
          (SELECT COUNT(*) FROM device_logs      WHERE timestamp >= NOW() - INTERVAL '7 days') +
          (SELECT COUNT(*) FROM tank_readings    WHERE timestamp >= NOW() - INTERVAL '7 days') +
          (SELECT COUNT(*) FROM environment_readings WHERE timestamp >= NOW() - INTERVAL '7 days') +
          (SELECT COUNT(*) FROM watering_events  WHERE timestamp >= NOW() - INTERVAL '7 days')
        AS total
      `.execute(db),
      sql<{ errors: number }>`
        SELECT COUNT(*)::int AS errors
        FROM app_logs
        WHERE source = 'mqttService' AND log_level = 'error'
          AND timestamp >= NOW() - INTERVAL '7 days'
      `.execute(db),
      sql<{ total: number; errors: number }>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE log_level = 'error')::int AS errors
        FROM app_logs
        WHERE source IN ('chatContext', 'aiSummaryService')
          AND timestamp >= NOW() - INTERVAL '7 days'
      `.execute(db),
    ]);

    const byBucket = apiRes.rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }));
    const apiTotal = byBucket.reduce((sum, r) => sum + r.count, 0);
    const mqttTotal = Number(mqttTotalRes.rows[0]?.total ?? 0);
    const mqttErrors = Number(mqttErrRes.rows[0]?.errors ?? 0);
    const aiRow = aiRes.rows[0] ?? { total: 0, errors: 0 };

    return {
      success: true,
      api: { total: apiTotal, by_bucket: byBucket },
      mqtt: { total: mqttTotal, errors: mqttErrors },
      ai: { total: Number(aiRow.total), errors: Number(aiRow.errors) },
    };
  } catch (err) {
    await logDbError(err, 'getServiceStats');
    return { success: false, ...empty };
  }
}

export async function saveAiSummary({
  summary,
}: {
  summary: string;
}): Promise<{ success: boolean }> {
  return tryMutate('saveAiSummary', () =>
    db.insertInto('ai_summaries').values({ summary }).execute().then(() => undefined)
  );
}

export async function getLatestAiSummary(): Promise<{
  success: boolean;
  row: AiSummary | null;
}> {
  return tryRow('getLatestAiSummary', () =>
    db
      .selectFrom('ai_summaries')
      .select(['summary', 'timestamp'])
      .orderBy('timestamp', 'desc')
      .limit(1)
      .executeTakeFirst()
  );
}

// ── Photo reactions ───────────────────────────────────────────────────────────

export async function getPhotoReactions(
  photoFilename: string
): Promise<{ success: boolean; rows: PhotoReactionRow[] }> {
  return tryRows('getPhotoReactions', async () => {
    const result = await sql<PhotoReactionRow>`
      SELECT pr.reaction,
             array_agg(COALESCE(u.display_name, SPLIT_PART(pr.user_email, '@', 1))) AS users,
             COUNT(*)::int AS count
      FROM photo_reactions pr
      LEFT JOIN users u ON u.email = pr.user_email
      WHERE pr.photo_filename = ${photoFilename}
      GROUP BY pr.reaction
    `.execute(db);
    return result.rows;
  });
}

export async function getUserDisplayName(email: string): Promise<string | null> {
  const row = await db
    .selectFrom('users')
    .select('display_name')
    .where('email', '=', email)
    .executeTakeFirst();
  return row?.display_name ?? null;
}

export async function getAllDisplayNames(): Promise<Record<string, string>> {
  const rows = await db.selectFrom('users').selectAll().execute();
  const map: Record<string, string> = {};
  rows.forEach((r) => {
    map[r.email] = r.display_name;
    map[r.email.split('@')[0]] = r.display_name;
  });
  return map;
}

export async function upsertPhotoReaction({
  photoFilename,
  userEmail,
  reaction,
}: {
  photoFilename: string;
  userEmail: string;
  reaction: string;
}): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('upsertPhotoReaction', () =>
    db
      .insertInto('photo_reactions')
      .values({ photo_filename: photoFilename, user_email: userEmail, reaction })
      .onConflict((oc) =>
        oc.columns(['photo_filename', 'user_email']).doUpdateSet({
          reaction,
          created_at: new Date(),
        })
      )
      .execute()
      .then(() => undefined)
  );
}

export async function removePhotoReaction({
  photoFilename,
  userEmail,
}: {
  photoFilename: string;
  userEmail: string;
}): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('removePhotoReaction', () =>
    db
      .deleteFrom('photo_reactions')
      .where('photo_filename', '=', photoFilename)
      .where('user_email', '=', userEmail)
      .execute()
      .then(() => undefined)
  );
}

// ── Device presence ───────────────────────────────────────────────────────────

export async function upsertDevicePresence({
  device_id,
  ip_address,
}: {
  device_id: string;
  ip_address: string;
}): Promise<void> {
  try {
    await db
      .insertInto('device_presence')
      .values({ device_id, ip_address, last_boot: new Date() })
      .onConflict((oc) =>
        oc.column('device_id').doUpdateSet({ ip_address, last_boot: new Date() })
      )
      .execute();
  } catch (err) {
    console.log('Failed to upsert device presence:', err);
  }
}

export async function getDevicesWithStatus(): Promise<{
  success: boolean;
  dbError?: DbError;
  rows: DeviceWithStatus[];
}> {
  return tryRows('getDevicesWithStatus', async () => {
    const result = await sql<DeviceWithStatus>`
      SELECT
        d.device_id,
        d.friendly_name,
        d.device_type,
        d.config,
        r.name        AS room_name,
        r.display_name AS room_display_name,
        dp.ip_address,
        dp.last_boot,
        GREATEST(
          dp.last_boot,
          (SELECT MAX(dl.timestamp) FROM device_logs dl         WHERE dl.device_id = d.device_id),
          (SELECT MAX(er.timestamp) FROM environment_readings er WHERE er.device_id = d.device_id),
          (SELECT MAX(tr.timestamp) FROM tank_readings tr        WHERE tr.device_id = d.device_id)
        ) AS last_seen,
        COALESCE(
          GREATEST(
            dp.last_boot,
            (SELECT MAX(dl.timestamp) FROM device_logs dl         WHERE dl.device_id = d.device_id),
            (SELECT MAX(er.timestamp) FROM environment_readings er WHERE er.device_id = d.device_id),
            (SELECT MAX(tr.timestamp) FROM tank_readings tr        WHERE tr.device_id = d.device_id)
          ) > NOW() - INTERVAL '12 hours',
          false
        ) AS healthy,
        d.has_ota AS ota_available,
        (
          SELECT json_object_agg(e.metric, e.value)
          FROM (
            SELECT DISTINCT ON (er.readings->>'metric')
              er.readings->>'metric' AS metric,
              er.readings->'value'   AS value
            FROM environment_readings er
            WHERE er.device_id = d.device_id
            ORDER BY er.readings->>'metric', er.timestamp DESC
          ) e
        ) AS latest_env_readings,
        (SELECT MAX(er.timestamp) FROM environment_readings er WHERE er.device_id = d.device_id) AS latest_env_timestamp,
        (
          SELECT row_to_json(t) FROM (
            SELECT
              tr.raw_value,
              CASE
                WHEN (d.config->>'calibration_raw')::numeric > 0
                  AND (d.config->>'calibration_gallons')::numeric > 0
                THEN ROUND(GREATEST(0, LEAST(
                  COALESCE((d.config->>'tank_capacity_gallons')::numeric, 30),
                  tr.raw_value
                    * (d.config->>'calibration_gallons')::numeric
                    / (d.config->>'calibration_raw')::numeric
                )), 1)
                ELSE ROUND(
                  (tr.pct_full / 100.0) * COALESCE((d.config->>'tank_capacity_gallons')::numeric, 30), 1
                )
              END AS gallons,
              CASE
                WHEN (d.config->>'calibration_raw')::numeric > 0
                  AND (d.config->>'calibration_gallons')::numeric > 0
                THEN ROUND(GREATEST(0, LEAST(100,
                  tr.raw_value
                    * (d.config->>'calibration_gallons')::numeric
                    / (d.config->>'calibration_raw')::numeric
                    / COALESCE((d.config->>'tank_capacity_gallons')::numeric, 30) * 100
                )), 1)
                ELSE tr.pct_full
              END AS pct_full,
              tr.timestamp
            FROM tank_readings tr
            WHERE tr.device_id = d.device_id
            ORDER BY tr.timestamp DESC LIMIT 1
          ) t
        ) AS latest_tank_reading,
        (
          SELECT row_to_json(w) FROM (
            SELECT status, action, timestamp
            FROM watering_events
            WHERE device_id = d.device_id
            ORDER BY timestamp DESC LIMIT 1
          ) w
        ) AS latest_pump_event
      FROM devices d
      LEFT JOIN rooms r           ON r.id          = d.room_id
      LEFT JOIN device_presence dp ON dp.device_id = d.device_id
      ORDER BY r.display_name, d.friendly_name
    `.execute(db);
    return result.rows;
  });
}

export async function createDevice({
  device_id,
  friendly_name,
  device_type,
  room_name,
  has_ota = false,
}: {
  device_id: string;
  friendly_name: string;
  device_type: string;
  room_name: string;
  has_ota?: boolean;
}): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('createDevice', async () => {
    const room = await db
      .selectFrom('rooms')
      .select('id')
      .where('name', '=', room_name)
      .executeTakeFirst();
    await db
      .insertInto('devices')
      .values({ device_id, friendly_name, device_type, room_id: room?.id ?? null, has_ota })
      .execute();
  });
}

// ── Device config ─────────────────────────────────────────────────────────────

export async function getDeviceConfig(device_id: string): Promise<DeviceConfig> {
  try {
    const row = await db
      .selectFrom('devices')
      .select('config')
      .where('device_id', '=', device_id)
      .executeTakeFirst();
    return (row?.config as DeviceConfig) ?? {};
  } catch {
    return {};
  }
}

export async function updateDeviceConfig(
  device_id: string,
  patch: DeviceConfig
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('updateDeviceConfig', async () => {
    await sql`
      UPDATE devices SET config = jsonb_strip_nulls(config || ${JSON.stringify(patch)}::jsonb)
      WHERE device_id = ${device_id}
    `.execute(db);
  });
}

// ── Schema maintenance ────────────────────────────────────────────────────────

// ── Chat sessions ─────────────────────────────────────────────────────────────

export async function createChatSession(
  sessionKey: string,
  personName?: string | null
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('createChatSession', () =>
    db
      .insertInto('chat_sessions')
      .values({ session_key: sessionKey, person_name: personName ?? null })
      .onConflict((oc) => oc.column('session_key').doNothing())
      .execute()
      .then(() => undefined)
  );
}

export async function getChatSession(sessionKey: string): Promise<{
  success: boolean;
  dbError?: DbError;
  row: ChatSession | null;
}> {
  return tryRow('getChatSession', () =>
    db
      .selectFrom('chat_sessions')
      .selectAll()
      .where('session_key', '=', sessionKey)
      .executeTakeFirst()
  );
}

export async function setChatSessionSummary(
  sessionKey: string,
  summary: string
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('setChatSessionSummary', () =>
    db
      .updateTable('chat_sessions')
      .set({ summary, ended_at: new Date() })
      .where('session_key', '=', sessionKey)
      .execute()
      .then(() => undefined)
  );
}

export async function getRecentSessionSummaries(limit = 5): Promise<string[]> {
  try {
    const rows = await db
      .selectFrom('chat_sessions')
      .select(['summary', 'started_at', 'person_name'])
      .where('summary', 'is not', null)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute();
    return rows
      .filter((r) => r.summary)
      .map((r) => {
        const date = r.started_at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const who = r.person_name ? ` (with ${r.person_name})` : '';
        return `[${date}${who}]: ${r.summary}`;
      });
  } catch {
    return [];
  }
}

// ── Chat messages ─────────────────────────────────────────────────────────────

export async function appendChatMessage(
  sessionKey: string,
  role: string,
  content: string
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('appendChatMessage', async () => {
    await sql`
      INSERT INTO chat_messages (session_id, role, content)
      SELECT id, ${role}, ${content} FROM chat_sessions WHERE session_key = ${sessionKey}
    `.execute(db);
  });
}

export async function getChatMessages(
  sessionKey: string
): Promise<ChatMessage[]> {
  try {
    const result = await sql<ChatMessage>`
      SELECT cm.id, cm.session_id, cm.role, cm.content, cm.timestamp
      FROM chat_messages cm
      JOIN chat_sessions cs ON cs.id = cm.session_id
      WHERE cs.session_key = ${sessionKey}
      ORDER BY cm.timestamp ASC
    `.execute(db);
    return result.rows;
  } catch {
    return [];
  }
}

// ── Home knowledge ────────────────────────────────────────────────────────────

export async function getAllHomeKnowledge(): Promise<HomeKnowledge[]> {
  try {
    return db
      .selectFrom('home_knowledge')
      .selectAll()
      .orderBy('subject')
      .orderBy('category')
      .execute();
  } catch {
    return [];
  }
}

export async function insertHomeKnowledge(
  subject: string,
  category: string,
  fact: string,
  embedding?: number[]
): Promise<{ success: boolean; dbError?: DbError; id: number | null }> {
  try {
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
    const row = await db
      .insertInto('home_knowledge')
      .values({ subject, category, fact, embedding: embeddingStr, updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { success: true, id: row.id };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, 'insertHomeKnowledge'), id: null };
  }
}

export async function updateHomeKnowledge(
  id: number,
  subject: string,
  category: string,
  fact: string,
  embedding?: number[]
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('updateHomeKnowledge', () => {
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
    return db
      .updateTable('home_knowledge')
      .set({ subject, category, fact, embedding: embeddingStr, updated_at: new Date() })
      .where('id', '=', id)
      .execute()
      .then(() => undefined);
  });
}

export async function deleteHomeKnowledge(
  id: number
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('deleteHomeKnowledge', () =>
    db.deleteFrom('home_knowledge').where('id', '=', id).execute().then(() => undefined)
  );
}

export async function searchHomeKnowledge(embedding: number[]): Promise<HomeKnowledge[]> {
  try {
    const vectorStr = `[${embedding.join(',')}]`;
    const result = await sql<HomeKnowledge>`
      SELECT * FROM home_knowledge
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT 8
    `.execute(db);
    return result.rows;
  } catch {
    return [];
  }
}

export async function getVisionPeople(): Promise<VisionPerson[]> {
  try {
    return db.selectFrom('vision_people').selectAll().orderBy('name').execute();
  } catch {
    return [];
  }
}

export async function upsertVisionPerson(
  name: string,
  photoCount: number
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('upsertVisionPerson', () =>
    db
      .insertInto('vision_people')
      .values({ name, photo_count: photoCount, enrolled_at: new Date() })
      .onConflict((oc) =>
        oc.column('name').doUpdateSet({
          photo_count: photoCount,
          enrolled_at: new Date(),
        })
      )
      .execute()
      .then(() => undefined)
  );
}

// ── Chat evals ────────────────────────────────────────────────────────────────

export async function insertChatEval(
  sessionKey: string,
  question: string,
  response: string,
  responseTimeMs: number
): Promise<{ success: boolean; id: number | null; dbError?: DbError }> {
  try {
    const row = await db
      .insertInto('chat_evals')
      .values({ session_key: sessionKey, question, response, response_time_ms: responseTimeMs })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { success: true, id: row.id };
  } catch (err) {
    return { success: false, id: null, dbError: await createDbError(err, 'insertChatEval') };
  }
}

export async function updateChatEvalRating(
  id: number,
  field: 'quality' | 'correctness',
  value: boolean
): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('updateChatEvalRating', () => {
    if (field === 'quality') {
      return db.updateTable('chat_evals').set({ quality: value }).where('id', '=', id).execute().then(() => undefined);
    }
    return db.updateTable('chat_evals').set({ correctness: value }).where('id', '=', id).execute().then(() => undefined);
  });
}

