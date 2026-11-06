import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { one, sql } from './db';
import type { Role } from './hr/core';

export const COOKIE_NAME = 'skillmint_session';
export type { Role };
export interface Actor {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
}

export const DEMO_ACTOR: Actor = {
  id: '00000000-0000-4000-8000-000000000001', organization_id: '00000000-0000-4000-8000-000000000002',
  full_name: 'SkillMint Development Admin', email: 'development-admin@skillmint.local', role: 'admin', active: true,
  must_change_password: false,
};

export function isDevDemoMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEV_DEMO_MODE === 'true';
}

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(value: string | undefined | null): string | null {
  return value?.trim().toLowerCase() || null;
}

export function normalizePhone(value: string | undefined | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  // For Indian mobile numbers treat +91 and 10-digit local forms as one identity.
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}

export async function getActor(): Promise<Actor | null> {
  if (isDevDemoMode()) return DEMO_ACTOR;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return one<Actor>(
    `SELECT u.id,u.organization_id,u.full_name,u.email,u.role,u.active,u.must_change_password
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
    [hashToken(token)],
  );
}

export async function createSession(userId: string, response: NextResponse): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const days = Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS || 7),1),30);
  await sql('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+($3::text || \' days\')::interval)',
            [userId,hashToken(token),days]);
  response.cookies.set(COOKIE_NAME,token,{
    httpOnly:true,
    secure:process.env.NODE_ENV === 'production',
    sameSite:'lax',
    maxAge:days*86400,
    path:'/',
  });
}

export async function revokeSession(response: NextResponse): Promise<void> {
  const token=(await cookies()).get(COOKIE_NAME)?.value;
  if(token) await sql('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token)]);
  response.cookies.set(COOKIE_NAME,'',{httpOnly:true,path:'/',maxAge:0,sameSite:'lax'});
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password,hash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password,12);
}

export function assertSameOrigin(request: NextRequest): void {
  const origin=request.headers.get('origin');
  if (!origin) return;
  let actual:string;
  try { actual=new URL(origin).origin; } catch { throw new HttpError(403,'Invalid origin'); }
  if(process.env.NODE_ENV==='development') {
    // next dev is intentionally bound to 0.0.0.0, so request.nextUrl.origin
    // can be 0.0.0.0 even though the browser legitimately uses localhost.
    // Do not trust arbitrary Host headers: accept only this narrow local list.
    const allowed=new Set(['http://localhost:3000','http://127.0.0.1:3000']);
    const configured=process.env.APP_ORIGIN;
    if(configured && allowed.has(configured)) allowed.add(configured);
    if(!allowed.has(actual)) throw new HttpError(403,'Invalid origin');
    return;
  }
  const expected = process.env.APP_ORIGIN || request.nextUrl.origin;
  if (actual !== new URL(expected).origin) throw new HttpError(403,'Invalid origin');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function ensureAdmin(actor: Actor): void {
  if(actor.role !== 'admin') throw new HttpError(403,'Admin permission required');
}

export function canAccess(actor: Actor, ownerId: string | null | undefined): boolean {
  return actor.role==='admin' || ownerId===actor.id;
}

export function ensureAccess(actor: Actor,ownerId: string | null | undefined): void {
  if(!canAccess(actor,ownerId)) throw new HttpError(404,'Record not found');
}
