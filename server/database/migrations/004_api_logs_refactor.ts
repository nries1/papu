import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS request_id`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS user_email`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS request_method`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS error_message`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS client_ip`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS user_agent`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS request_url`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS level`.execute(db);

  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_logs' AND column_name = 'request_path') THEN
        ALTER TABLE api_logs RENAME COLUMN request_path TO path;
      END IF;
    END $$
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_logs' AND column_name = 'response_code') THEN
        ALTER TABLE api_logs RENAME COLUMN response_code TO status_code;
      END IF;
    END $$
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS request_id text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS user_email text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS request_method text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS error_message text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS client_ip text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS user_agent text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS request_url text`.execute(db);
  await sql`ALTER TABLE api_logs ADD COLUMN IF NOT EXISTS level text`.execute(db);

  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_logs' AND column_name = 'path') THEN
        ALTER TABLE api_logs RENAME COLUMN path TO request_path;
      END IF;
    END $$
  `.execute(db);

  await sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_logs' AND column_name = 'status_code') THEN
        ALTER TABLE api_logs RENAME COLUMN status_code TO response_code;
      END IF;
    END $$
  `.execute(db);
}
