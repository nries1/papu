import { db } from './db';
import { up as up001 } from './migrations/001_initial';
import { up as up002 } from './migrations/002_users';

async function main() {
  console.log('Running migrations...');
  try {
    await up001(db);
    await up002(db);
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
