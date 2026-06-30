import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS chat_evals (
      id               SERIAL PRIMARY KEY,
      session_key      TEXT NOT NULL,
      question         TEXT NOT NULL,
      response         TEXT NOT NULL,
      response_time_ms INTEGER NOT NULL,
      quality          BOOLEAN,
      correctness      BOOLEAN,
      timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_chat_evals_timestamp ON chat_evals (timestamp DESC)`.execute(db);
}
