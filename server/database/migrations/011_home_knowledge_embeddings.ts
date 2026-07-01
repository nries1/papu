import { sql } from 'kysely';

export async function up(db: any): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);
  await sql`ALTER TABLE home_knowledge ADD COLUMN IF NOT EXISTS embedding vector(768)`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_home_knowledge_embedding
    ON home_knowledge USING hnsw (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL
  `.execute(db);
}
