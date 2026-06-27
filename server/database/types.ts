export interface WateringEvent {
  id: number;
  device_id: string;
  status: string;
  duration_ms: number | null;
  action: string | null;
  started_by: string | null;
  timestamp: Date;
}

export interface TankReading {
  device_id: string;
  gallons: number;
  raw_value: number;
  pct_full: number;
  timestamp: Date;
}

export interface TankReadingWithRoom extends TankReading {
  room_name: string | null;
}

export interface WaterEventWithRoom {
  device_id: string;
  timestamp: Date;
  status: string;
  room_name: string | null;
}

export interface DeviceConfig {
  tank_capacity_gallons?: number;
  calibration_raw?: number;
  calibration_gallons?: number;
}

export interface Device {
  device_id: string;
  room_id: number | null;
  friendly_name: string | null;
  device_type: string | null;
  config: DeviceConfig;
}

export interface RoomWithDevices {
  id: number;
  name: string;
  display_name: string | null;
  devices: Array<{ device_id: string; friendly_name: string }>;
}

export interface EnvironmentReading {
  device_id: string;
  room_name: string | null;
  readings: { metric: string; value: number };
  timestamp: Date;
}

export interface AiSummary {
  summary: string;
  timestamp: Date;
}

export interface PhotoReactionRow {
  reaction: string;
  users: string[];
  count: number;
}

export interface SystemLog {
  log_type: string;
  log_level: string;
  message: string;
  source: string | null;
  details: unknown;
  timestamp: Date;
}

export interface SensorHealthMetrics {
  total_count: number;
  min_value: number;
  max_value: number;
  mean_value: number;
  std_dev: number;
  median_value: number;
  mode_value: number;
}

export interface DailyStdDev {
  day: Date;
  daily_stddev: number;
}

export interface ChatSession {
  id: number;
  session_key: string;
  started_at: Date;
  ended_at: Date | null;
  summary: string | null;
  person_name: string | null;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  timestamp: Date;
}

export interface HomeKnowledge {
  id: number;
  subject: string;
  category: string;
  fact: string;
  updated_at: Date;
}

export interface VisionPerson {
  id: number;
  name: string;
  enrolled_at: Date;
  photo_count: number;
}

export interface DeviceWithStatus {
  device_id: string;
  friendly_name: string | null;
  device_type: string | null;
  room_name: string | null;
  room_display_name: string | null;
  ip_address: string | null;
  last_boot: Date | null;
  last_seen: Date | null;
  healthy: boolean;
  ota_available: boolean;
  config: DeviceConfig;
  latest_env_readings: Record<string, number> | null;
  latest_env_timestamp: Date | null;
  latest_tank_reading: { raw_value: number; gallons: number; pct_full: number; timestamp: Date } | null;
  latest_pump_event: { status: string; action: string | null; timestamp: Date } | null;
}
