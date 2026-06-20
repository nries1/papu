// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('rooms')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('display_name', 'text')
    .execute();

  await db.schema
    .createTable('devices')
    .ifNotExists()
    .addColumn('device_id', 'text', (col) => col.primaryKey())
    .addColumn('room_id', 'integer', (col) => col.references('rooms.id'))
    .addColumn('friendly_name', 'text')
    .addColumn('device_type', 'text')
    .execute();

  await db.schema
    .createTable('watering_events')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('device_id', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('duration_ms', 'integer')
    .addColumn('action', 'text')
    .addColumn('started_by', 'text')
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('tank_readings')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('device_id', 'text', (col) => col.notNull())
    .addColumn('gallons', 'numeric', (col) => col.notNull())
    .addColumn('raw_value', 'numeric', (col) => col.notNull())
    .addColumn('pct_full', 'numeric', (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('environment_readings')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('device_id', 'text', (col) => col.notNull())
    .addColumn('room_id', 'integer')
    .addColumn('readings', 'jsonb', (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('api_logs')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('request_id', 'text')
    .addColumn('user_email', 'text')
    .addColumn('request_method', 'text')
    .addColumn('request_path', 'text')
    .addColumn('request_body', 'jsonb')
    .addColumn('response_code', 'integer')
    .addColumn('response_body', 'jsonb')
    .addColumn('response_time_ms', 'integer')
    .addColumn('error_message', 'text')
    .addColumn('client_ip', 'text')
    .addColumn('user_agent', 'text')
    .addColumn('request_url', 'text')
    .addColumn('level', 'text')
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('app_logs')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('log_level', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('details', 'jsonb')
    .addColumn('source', 'text')
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('db_logs')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('log_level', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('details', 'jsonb')
    .addColumn('source', 'text')
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('device_logs')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('device_id', 'text', (col) => col.notNull())
    .addColumn('log_level', 'text', (col) => col.notNull())
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('details', 'jsonb')
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('ai_summaries')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('summary', 'text', (col) => col.notNull())
    .addColumn('timestamp', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute();

  await db.schema
    .createTable('photo_reactions')
    .ifNotExists()
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('photo_filename', 'text', (col) => col.notNull())
    .addColumn('user_email', 'text', (col) => col.notNull())
    .addColumn('reaction', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addUniqueConstraint('photo_reactions_photo_user_uniq', ['photo_filename', 'user_email'])
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('photo_reactions').ifExists().execute();
  await db.schema.dropTable('ai_summaries').ifExists().execute();
  await db.schema.dropTable('device_logs').ifExists().execute();
  await db.schema.dropTable('db_logs').ifExists().execute();
  await db.schema.dropTable('app_logs').ifExists().execute();
  await db.schema.dropTable('api_logs').ifExists().execute();
  await db.schema.dropTable('environment_readings').ifExists().execute();
  await db.schema.dropTable('tank_readings').ifExists().execute();
  await db.schema.dropTable('watering_events').ifExists().execute();
  await db.schema.dropTable('devices').ifExists().execute();
  await db.schema.dropTable('rooms').ifExists().execute();
}
