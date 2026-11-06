import type { PGlite } from '@electric-sql/pglite';

/** Must be imported before any module that loads src/lib/db.ts, so the pg pool is replaced by PGlite. */
export const holder: { db: PGlite | null } = { db: null };
const adapter = {
  query: async (text: string, params?: unknown[]) => { const r = await holder.db!.query(text, params as never); return { rows: r.rows as unknown[] }; },
  release() { /* single connection */ },
  async connect() { return adapter; },
  async end() { /* no-op */ },
};
(globalThis as unknown as { skillmintPool: unknown }).skillmintPool = adapter;
