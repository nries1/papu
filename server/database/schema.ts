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

interface ChatSessionsTable {
  id: Generated<number>;
  session_key: string;
  started_at: Generated<Date>;
  ended_at: Date | null;
  summary: string | null;
  person_name: string | null;
}

interface ChatMessagesTable {
  id: Generated<number>;
  session_id: number;
  role: string;
  content: string;
  timestamp: Generated<Date>;
}

interface HomeKnowledgeTable {
  id: Generated<number>;
  subject: string;
  category: string;
  fact: string;
  embedding: ColumnType<string | null, string | null, string | null>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface VisionPeopleTable {
  id: Generated<number>;
  name: string;
  enrolled_at: Generated<Date>;
  photo_count: number;
}

interface ChatEvalsTable {
  id: Generated<number>;
  session_key: string;
  question: string;
  response: string;
  response_time_ms: number;
  quality: boolean | null;
  correctness: boolean | null;
  timestamp: Generated<Date>;
}

export interface Database {
  watering_events: WateringEventsTable;
  tank_readings: TankReadingsTable;
  devices: DevicesTable;
  rooms: RoomsTable;
  environment_readings: EnvironmentReadingsTable;
  api_logs: ApiLogsTable;
  app_logs: AppLogsTable;
  device_logs: DeviceLogsTable;
  ai_summaries: AiSummariesTable;
  photo_reactions: PhotoReactionsTable;
  users: UsersTable;
  device_presence: DevicePresenceTable;
  chat_sessions: ChatSessionsTable;
  chat_messages: ChatMessagesTable;
  home_knowledge: HomeKnowledgeTable;
  vision_people: VisionPeopleTable;
  chat_evals: ChatEvalsTable;
  schema_migrations: SchemaMigrationsTable;
}

interface SchemaMigrationsTable {
  version: string;
  applied_at: Generated<Date>;
}
