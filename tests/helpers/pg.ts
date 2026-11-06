import { holder } from './pool';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { matchRoute, RuleError } from '../../src/lib/hr/core';
import { HttpError, type Actor } from '../../src/lib/auth';
import type { ServerRoute } from '../../src/lib/hr/server';

export const ORG = '00000000-0000-4000-8000-0000000000aa';
export const USER_IDS = { admin: '00000000-0000-4000-8000-0000000000a1', hr_manager: '00000000-0000-4000-8000-0000000000a2', employee: '00000000-0000-4000-8000-0000000000a3', finance: '00000000-0000-4000-8000-0000000000a4' } as const;
export const actorFor = (role: keyof typeof USER_IDS): Actor => ({ id: USER_IDS[role], organization_id: ORG, full_name: `Test ${role}`, email: `${role}@test.local`, role, active: true, must_change_password: false });

/** Applies schema.sql and every migration (twice, to prove they are idempotent) to a fresh in-process PostgreSQL. */
export async function setupDb(applyTwice = true) {
  holder.db = new PGlite();
  const db = holder.db;
  const root = resolve(process.cwd(), 'db');
  const files = ['schema.sql', ...(await readdir(resolve(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort().map(f => `migrations/${f}`)];
  for (let pass = 0; pass < (applyTwice ? 2 : 1); pass++)
    for (const f of files) await db.exec((await readFile(resolve(root, f), 'utf8')).replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/i, ''));
  await db.exec(`INSERT INTO organizations(id,name) VALUES('${ORG}','SkillMint Test Org')`);
  for (const [role, id] of Object.entries(USER_IDS))
    await db.exec(`INSERT INTO users(id,organization_id,full_name,email,password_hash,role,team) VALUES('${id}','${ORG}','Test ${role}','${role}@test.local','x','${role}','Team ${role}')`);
  return db;
}
export const db = () => holder.db!;

export interface Reply { status: number; body: any; text: string; headers: Headers }
export async function invoke(routes: ServerRoute[], actor: Actor, method: string, path: string, body?: unknown): Promise<Reply> {
  const [p, qs = ''] = path.split('?');
  const found = matchRoute(routes, method, p.split('/').filter(Boolean));
  if (!found) throw new Error(`No route for ${method} ${path}`);
  const request = new NextRequest('http://localhost/api', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  try {
    const res = await found.handle({ actor, params: found.params, query: new URLSearchParams(qs), request });
    const text = await res.text(); let parsed: unknown = null; try { parsed = JSON.parse(text); } catch { /* binary or csv */ }
    return { status: res.status, body: parsed, text, headers: res.headers };
  } catch (error) {
    if (error instanceof HttpError || error instanceof RuleError) return { status: error.status, body: { error: error.message }, text: error.message, headers: new Headers() };
    throw error;
  }
}
