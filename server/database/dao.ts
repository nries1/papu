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
  RoomWithDevices,
  EnvironmentReading,
  AiSummary,
  PhotoReactionRow,
  SystemLog,
  SensorHealthMetrics,
  DailyStdDev,
  DeviceWithStatus,
} from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tryRows<T>(
  source: string,
  fn: () => Promise<T[]>
): Promise<{ success: boolean; dbError?: DbError; rows: T[] }> {
  try {
    return { success: true, rows: await fn() };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, source), rows: [] };
  }
}

async function tryRow<T>(
  source: string,
  fn: () => Promise<T | undefined>
): Promise<{ success: boolean; dbError?: DbError; row: T | null }> {
  try {
    return { success: true, row: (await fn()) ?? null };
  } catch (err) {
    return { success: false, dbError: await createDbError(err, source), row: null };
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
    return { success: false, dbError: await createDbError(err, source) };
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

const API_LOG_MAX_ROWS = parseInt(process.env.API_LOG_MAX_ROWS ?? '50000', 10);

async function appendApiLog({ req, res }: { req: Request; res: Response }): Promise<void> {
  const isError = res.statusCode >= 400;
  const body = res.locals.responseBody as Record<string, unknown> | undefined;
  await db
    .insertInto('api_logs')
    .values({
      request_id: req.requestId ?? null,
      user_email: req.userEmail ?? null,
      request_method: req.method,
      request_path: req.path ?? req.originalUrl,
      request_body: req.body != null ? JSON.stringify(req.body) : null,
      response_code: res.statusCode ?? null,
      response_body: body != null ? JSON.stringify(body) : null,
      response_time_ms: req.startTime ? Date.now() - req.startTime : null,
      error_message: isError && body?.['error'] ? String(body['error']) : null,
      client_ip: req.ip ?? null,
      user_agent: (req.headers['user-agent'] as string) ?? null,
      request_url: req.url,
      level: isError ? 'error' : 'info',
    })
    .execute();

  try {
    await sql`
      DELETE FROM api_logs
      WHERE id <= (
        SELECT id FROM api_logs ORDER BY id DESC LIMIT 1 OFFSET ${sql.val(API_LOG_MAX_ROWS)}
      )
    `.execute(db);
  } catch (err) {
    console.log('Failed to trim api_logs:', err);
  }
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
        SELECT 'app'    AS log_type, log_level, message, source, timestamp FROM app_logs
        UNION ALL
        SELECT 'db'     AS log_type, log_level, message, source, timestamp FROM db_logs
        UNION ALL
        SELECT 'api'    AS log_type,
               COALESCE(level, 'info') AS log_level,
               request_method || ' ' || request_path AS message,
               COALESCE(user_email, client_ip::text, 'unknown') AS source,
               timestamp
        FROM api_logs
        UNION ALL
        SELECT 'device' AS log_type, dl.log_level, dl.message,
               COALESCE(d.friendly_name, dl.device_id) AS source, dl.timestamp
        FROM device_logs dl
        LEFT JOIN devices d ON d.device_id = dl.device_id
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
        EXISTS(
          SELECT 1 FROM device_logs dl
          WHERE dl.device_id = d.device_id
            AND dl.timestamp > NOW() - INTERVAL '12 hours'
        ) AS healthy,
        COALESCE(
          GREATEST(
            dp.last_boot,
            (SELECT MAX(dl.timestamp) FROM device_logs dl         WHERE dl.device_id = d.device_id),
            (SELECT MAX(er.timestamp) FROM environment_readings er WHERE er.device_id = d.device_id),
            (SELECT MAX(tr.timestamp) FROM tank_readings tr        WHERE tr.device_id = d.device_id)
          ) > NOW() - INTERVAL '2 hours',
          false
        ) AS ota_available
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
}: {
  device_id: string;
  friendly_name: string;
  device_type: string;
  room_name: string;
}): Promise<{ success: boolean; dbError?: DbError }> {
  return tryMutate('createDevice', async () => {
    const room = await db
      .selectFrom('rooms')
      .select('id')
      .where('name', '=', room_name)
      .executeTakeFirst();
    await db
      .insertInto('devices')
      .values({ device_id, friendly_name, device_type, room_id: room?.id ?? null })
      .execute();
  });
}

// ── Schema maintenance ────────────────────────────────────────────────────────

