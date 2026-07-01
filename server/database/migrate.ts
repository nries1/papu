import { sql } from 'kysely';
import { db } from './db';
import { up as up001 } from './migrations/001_initial';
import { up as up002 } from './migrations/002_users';
import { up as up003 } from './migrations/003_device_config';
import { up as up004 } from './migrations/004_api_logs_refactor';
import { up as up005 } from './migrations/005_chat_context';
import { up as up006 } from './migrations/006_home_knowledge_refactor';
import { up as up007 } from './migrations/007_vision_people';
import { up as up008 } from './migrations/008_log_cleanup';
import { up as up009 } from './migrations/009_drop_db_logs';
import { up as up010 } from './migrations/010_chat_evals';
import { up as up011 } from './migrations/011_home_knowledge_embeddings';

async function ensureMigrationsTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runMigration(version: string, up: (db: any) => Promise<void>): Promise<void> {
  const existing = await db
    .selectFrom('schema_migrations')
    .select('version')
    .where('version', '=', version)
    .executeTakeFirst();

  if (existing) {
    console.log(`  ${version}: already applied, skipping`);
    return;
  }

  await up(db);
  await db.insertInto('schema_migrations').values({ version }).execute();
  console.log(`  ${version}: applied`);
}

async function main() {
  console.log('Running migrations...');
  try {
    await ensureMigrationsTable();
    await runMigration('001_initial', up001);
    await runMigration('002_users', up002);
    await runMigration('003_device_config', up003);
    await runMigration('004_api_logs_refactor', up004);
    await runMigration('005_chat_context', up005);
    await runMigration('006_home_knowledge_refactor', up006);
    await runMigration('007_vision_people', up007);
    await runMigration('008_log_cleanup', up008);
    await runMigration('009_drop_db_logs', up009);
    await runMigration('010_chat_evals', up010);
    await runMigration('011_home_knowledge_embeddings', up011);
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
