import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:pass@db:5432/plants',
});

pool.on('connect', () => console.log('PostgreSQL Pool Connected'));
pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

export default pool;
