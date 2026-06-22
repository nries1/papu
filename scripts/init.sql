-- Database: plants
-- Run once against a fresh database, or re-run safely (all CREATE TABLE use IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS rooms (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  room_id      INTEGER REFERENCES rooms(id),
  friendly_name TEXT,
  device_type  TEXT,
  has_ota      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS watering_events (
  id          SERIAL PRIMARY KEY,
  device_id   TEXT        NOT NULL,
  status      TEXT        NOT NULL,
  duration_ms INTEGER,
  action      TEXT,
  started_by  TEXT,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tank_readings (
  id        SERIAL PRIMARY KEY,
  device_id TEXT    NOT NULL,
  gallons   NUMERIC NOT NULL,
  raw_value NUMERIC NOT NULL,
  pct_full  NUMERIC NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environment_readings (
  id        SERIAL PRIMARY KEY,
  device_id TEXT        NOT NULL,
  room_id   INTEGER,
  readings  JSONB       NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_logs (
  id               SERIAL PRIMARY KEY,
  request_id       TEXT,
  user_email       TEXT,
  request_method   TEXT,
  request_path     TEXT,
  request_body     JSONB,
  response_code    INTEGER,
  response_body    JSONB,
  response_time_ms INTEGER,
  error_message    TEXT,
  client_ip        TEXT,
  user_agent       TEXT,
  request_url      TEXT,
  level            TEXT,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_logs (
  id        SERIAL PRIMARY KEY,
  log_level TEXT        NOT NULL,
  message   TEXT        NOT NULL,
  details   JSONB,
  source    TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS db_logs (
  id        SERIAL PRIMARY KEY,
  log_level TEXT        NOT NULL,
  message   TEXT        NOT NULL,
  details   JSONB,
  source    TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_logs (
  id        SERIAL PRIMARY KEY,
  device_id TEXT        NOT NULL,
  log_level TEXT        NOT NULL,
  message   TEXT        NOT NULL,
  details   JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id        SERIAL PRIMARY KEY,
  summary   TEXT        NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photo_reactions (
  id             SERIAL PRIMARY KEY,
  photo_filename TEXT        NOT NULL,
  user_email     TEXT        NOT NULL,
  reaction       TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (photo_filename, user_email)
);

CREATE TABLE IF NOT EXISTS users (
  email        TEXT PRIMARY KEY,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_presence (
  device_id  TEXT PRIMARY KEY,
  ip_address TEXT,
  last_boot  TIMESTAMPTZ NOT NULL DEFAULT now()
);
