import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // Drop dead duplicate columns from api_logs that were never written to
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS request_headers`.execute(db);
  await sql`ALTER TABLE api_logs DROP COLUMN IF EXISTS response_status`.execute(db);
  // Rename created_at → timestamp for consistency with other log tables (if created_at exists)
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_logs' AND column_name = 'created_at'
      ) THEN
        ALTER TABLE api_logs RENAME COLUMN created_at TO timestamp;
      END IF;
    END $$
  `.execute(db);

  // Add retention index on app_logs if missing
  await sql`
    CREATE INDEX IF NOT EXISTS idx_app_logs_timestamp ON app_logs (timestamp DESC)
  `.execute(db);

  // Add retention index on device_logs if missing
  await sql`
    CREATE INDEX IF NOT EXISTS idx_device_logs_timestamp ON device_logs (timestamp DESC)
  `.execute(db);
}
