import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // Drop dead columns that were never written to
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS request_headers`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS response_status`.execute(db);
  // Drop the null-only timestamp column and rename created_at → timestamp for consistency
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS timestamp`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_api_logs_status`.execute(db);
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_logs' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE api_logs RENAME COLUMN created_at TO timestamp;
        DROP INDEX IF EXISTS idx_api_logs_created_at;
        CREATE INDEX IF NOT EXISTS idx_api_logs_timestamp ON api_logs (timestamp DESC);
      END IF;
    END $$
  `.execute(db);

  // Add retention indexes on other log tables
  await sql`CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs (timestamp DESC)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_device_logs_timestamp ON device_logs (timestamp DESC)`.execute(db);
}
