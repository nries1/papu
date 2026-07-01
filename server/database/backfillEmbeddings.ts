import { sql } from 'kysely';
import { db } from './db';
import { getEmbedding } from '../api/ollama';

async function main() {
  const rows = await db
    .selectFrom('home_knowledge')
    .select(['id', 'fact'])
    .where('embedding', 'is', null)
    .execute();

  console.log(`Backfilling ${rows.length} facts...`);

  for (const row of rows) {
    const embedding = await getEmbedding(row.fact);
    const vectorStr = `[${embedding.join(',')}]`;
    await sql`UPDATE home_knowledge SET embedding = ${vectorStr}::vector WHERE id = ${row.id}`.execute(db);
    console.log(`  [${row.id}] done`);
  }

  console.log('Backfill complete.');
  await db.destroy();
}

main().catch((err) => { console.error(err); process.exit(1); });
