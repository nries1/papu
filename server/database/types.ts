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

export interface Device {
  device_id: string;
  room_id: number | null;
  friendly_name: string | null;
  device_type: string | null;
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
}
