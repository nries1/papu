import crypto from 'crypto';

const PG_ERROR_NAMES: Record<string, string> = {
  '23505': 'Duplicate entry',
  '23503': 'Related record not found',
  '23502': 'Required field missing',
  '23514': 'Value out of allowed range',
  '42703': 'Unknown column',
  '42P01': 'Table not found',
  '42601': 'Query syntax error',
  '08000': 'Database connection failed',
  '08003': 'Database connection failed',
  '08006': 'Database connection failed',
  '57014': 'Query timed out',
  '53300': 'Too many connections',
  '40001': 'Conflict, please retry',
  '40P01': 'Deadlock detected',
};

export class DbError extends Error {
  constructor(
    public readonly name: string,
    public readonly debugId: string,
    public readonly details: Record<string, unknown>
  ) {
    super(name);
  }
}

export function createDbError(raw: unknown, source: string): DbError {
  const debugId = crypto.randomBytes(3).toString('hex');
  const pgErr = raw as Record<string, unknown>;
  const pgCode = pgErr?.['code'] as string | undefined;
  const name = (pgCode && PG_ERROR_NAMES[pgCode]) ?? 'Database error';

  return new DbError(name, debugId, {
    source,
    debugId,
    code: pgCode ?? null,
    severity: pgErr['severity'] ?? null,
    detail: pgErr['detail'] ?? null,
    hint: pgErr['hint'] ?? null,
    position: pgErr['position'] ?? null,
    routine: pgErr['routine'] ?? null,
  });
}
