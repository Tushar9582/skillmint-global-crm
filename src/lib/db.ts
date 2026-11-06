import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const globalPool = globalThis as typeof globalThis & { skillmintPool?: Pool };

export const pool = globalPool.skillmintPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
if (process.env.NODE_ENV !== 'production') globalPool.skillmintPool = pool;

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
