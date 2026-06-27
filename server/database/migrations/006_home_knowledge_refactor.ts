import { Kysely, sql } from 'kysely';

// Replaces the key/category/value shape with subject/category/fact.
// subject is not unique (multiple facts per subject), so we add a serial id as PK.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE home_knowledge RENAME COLUMN key TO subject`.execute(db);
  await sql`ALTER TABLE home_knowledge RENAME COLUMN value TO fact`.execute(db);
  await sql`ALTER TABLE home_knowledge DROP CONSTRAINT home_knowledge_pkey`.execute(db);
  await sql`ALTER TABLE home_knowledge ADD COLUMN id SERIAL PRIMARY KEY`.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE home_knowledge DROP COLUMN id`.execute(db);
  await sql`ALTER TABLE home_knowledge RENAME COLUMN fact TO value`.execute(db);
  await sql`ALTER TABLE home_knowledge RENAME COLUMN subject TO key`.execute(db);
  await sql`ALTER TABLE home_knowledge ADD PRIMARY KEY (key)`.execute(db);
}
