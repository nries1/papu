import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS vision_people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      photo_count INTEGER NOT NULL DEFAULT 0
    )
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS vision_people`.execute(db);
}
