import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { postgresConnectionOptions } from './db-config';

const globalPool = globalThis as typeof globalThis & { skillmintPool?: Pool };
let currentPool: Pool | undefined;

/**
 * Next.js imports API route modules during `next build` to collect route data.
 * Do not read/validate DATABASE_URL or the Supabase CA when the module is imported:
 * Netlify runtime secrets may not be available during the build.
 * Fail closed when a real database operation is first attempted instead.
 */
export function getPool(): Pool {
  if (!currentPool) {
    currentPool = globalPool.skillmintPool ?? new Pool({
      ...postgresConnectionOptions(),
      max: Math.min(Math.max(Number(process.env.DB_POOL_MAX || 3), 1), 10),
      allowExitOnIdle: true,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    if (process.env.NODE_ENV !== 'production') globalPool.skillmintPool = currentPool;
  }
  return currentPool;
}

/** Backwards-compatible lazy Pool facade for existing imports and CLI scripts. */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const actual = getPool();
    const value: unknown = Reflect.get(actual, property, actual);
    return typeof value === 'function' ? value.bind(actual) : value;
  },
  set(_target, property, value) {
    return Reflect.set(getPool(), property, value);
  },
});

export async function sql<T = QueryResultRow>(
  query: string,
  params: unknown[] = [],
  client: Pool | PoolClient = pool,
): Promise<T[]> {
  const result = await client.query<QueryResultRow>(query, params);
  return result.rows as T[];
}

export async function one<T = QueryResultRow>(
  query: string,
  params: unknown[] = [],
  client: Pool | PoolClient = pool,
): Promise<T | null> {
  return (await sql<T>(query, params, client))[0] ?? null;
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
