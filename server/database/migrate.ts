import { db } from './db';
import { up as up001 } from './migrations/001_initial';
import { up as up002 } from './migrations/002_users';
import { up as up003 } from './migrations/003_device_config';
import { up as up004 } from './migrations/004_api_logs_refactor';
import { up as up005 } from './migrations/005_chat_context';
import { up as up006 } from './migrations/006_home_knowledge_refactor';
import { up as up007 } from './migrations/007_vision_people';

async function main() {
  console.log('Running migrations...');
  try {
    await up001(db);
    await up002(db);
    await up003(db);
    await up004(db);
    await up005(db);
    await up006(db);
    await up007(db);
    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
