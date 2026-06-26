import type { Generated, ColumnType } from 'kysely';

type JsonbNullable = ColumnType<unknown, string | null, string | null>;
type JsonbRequired = ColumnType<Record<string, unknown>, string, string>;

interface WateringEventsTable {
  id: Generated<number>;
  device_id: string;
  status: string;
  duration_ms: number | null;
  action: string | null;
  started_by: string | null;
  timestamp: Generated<Date>;
}

interface TankReadingsTable {
  id: Generated<number>;
  device_id: string;
  gallons: number;
  raw_value: number;
  pct_full: number;
  timestamp: Generated<Date>;
}

interface DevicesTable {
  device_id: string;
  room_id: number | null;
  friendly_name: string | null;
  device_type: string | null;
  has_ota: boolean;
  config: ColumnType<Record<string, unknown>, string | undefined, string>;
}

interface RoomsTable {
  id: Generated<number>;
  name: string;
  display_name: string | null;
}

interface EnvironmentReadingsTable {
  id: Generated<number>;
  device_id: string;
  room_id: number | null;
  readings: JsonbRequired;
  timestamp: Generated<Date>;
}

interface ApiLogsTable {
  id: Generated<number>;
  path: string | null;
  request_body: JsonbNullable;
  status_code: number | null;
  response_body: JsonbNullable;
  response_time_ms: number | null;
  timestamp: Generated<Date>;
}

interface AppLogsTable {
  id: Generated<number>;
  log_level: string;
  message: string;
  details: JsonbNullable;
  source: string | null;
  timestamp: Generated<Date>;
}

interface DbLogsTable {
  id: Generated<number>;
  log_level: string;
  message: string;
  details: JsonbNullable;
  source: string | null;
  timestamp: Generated<Date>;
}

interface DeviceLogsTable {
  id: Generated<number>;
  device_id: string;
  log_level: string;
  message: string;
  details: JsonbNullable;
  timestamp: Generated<Date>;
}

interface AiSummariesTable {
  id: Generated<number>;
  summary: string;
  timestamp: Generated<Date>;
}

interface PhotoReactionsTable {
  id: Generated<number>;
  photo_filename: string;
  user_email: string;
  reaction: string;
  created_at: ColumnType<Date, Date | undefined, Date>;
}

interface UsersTable {
  email: string;
  display_name: string;
}

interface DevicePresenceTable {
  device_id: string;
  ip_address: string | null;
  last_boot: ColumnType<Date, Date | undefined, Date>;
}

export interface Database {
  watering_events: WateringEventsTable;
  tank_readings: TankReadingsTable;
  devices: DevicesTable;
  rooms: RoomsTable;
  environment_readings: EnvironmentReadingsTable;
  api_logs: ApiLogsTable;
  app_logs: AppLogsTable;
  db_logs: DbLogsTable;
  device_logs: DeviceLogsTable;
  ai_summaries: AiSummariesTable;
  photo_reactions: PhotoReactionsTable;
  users: UsersTable;
  device_presence: DevicePresenceTable;
}
