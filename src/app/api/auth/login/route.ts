import { NextRequest } from 'next/server';
import { assertSameOrigin, checkPassword, clearDemoLoginFailures, createDemoSession, createSession, HttpError,
  isDemoLoginRateLimited, isDemoModeRequested, isStagingDemoMode, normalizeEmail, recordDemoLoginFailure } from '@/lib/auth';
import { one, sql } from '@/lib/db';
import { json } from '@/lib/http';

function demoRateKeys(request: NextRequest, email: string): string[] {
  const ip = request.headers.get('x-nf-client-connection-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  return [`ip:${ip}`, `identity:${ip}:${email}`];
}

async function stagingLogin(request: NextRequest): Promise<Response> {
  if (!isStagingDemoMode()) return json({ error: 'Isolated demo login is unavailable. Check the staging-only configuration.' }, 503);
  let input: unknown;
  try { input = await request.json(); } catch { return json({ error: 'Email and password required' }, 400); }
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || password.length > 256) return json({ error: 'Email and password required' }, 400);
  const keys = demoRateKeys(request, email);
  if (isDemoLoginRateLimited(keys)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  let valid = false;
  try {
    const passwordMatches = await checkPassword(password, process.env.DEMO_ADMIN_PASSWORD_HASH!);
    valid = email === normalizeEmail(process.env.DEMO_ADMIN_EMAIL) && passwordMatches;
  } catch {
    return json({ error: 'Isolated demo login is unavailable. Check the staging-only configuration.' }, 503);
  }
  if (!valid) {
    recordDemoLoginFailure(keys);
    return json({ error: 'Invalid email or password' }, 401);
  }
  clearDemoLoginFailures(keys);
  const response = json({ user: { id: '00000000-0000-4000-8000-000000000001', full_name: 'SkillMint Demo Administrator',
    email: process.env.DEMO_ADMIN_EMAIL, role: 'admin', must_change_password: false }, mode: 'isolated-demo' });
  createDemoSession(response);
  return response;
}

export async function POST(request:NextRequest) {
  try {
    assertSameOrigin(request);
    if (isDemoModeRequested()) return await stagingLogin(request);
    if (!process.env.DATABASE_URL) return json({error:'Secure login is not configured yet. Contact your administrator.'},503);
    const input=await request.json();
    if(!input || typeof input!=='object' || Array.isArray(input)) return json({error:'Email and password required'},400);
    const {email,password}=input as {email?:unknown;password?:unknown};
    const normalized=normalizeEmail(String(email||''));
    if(!normalized || typeof password!=='string' || !password || password.length>256) return json({error:'Email and password required'},400);
    const recentlyFailed=await one<{count:string}>(
      `SELECT count(*)::text AS count FROM login_history
       WHERE email=$1 AND success=false AND created_at>now()-interval '15 minutes'`,[normalized]);
    if(Number(recentlyFailed?.count||0)>=10) return json({error:'Too many attempts. Try again in 15 minutes.'},429);
    const user=await one<{id:string;full_name:string;email:string;password_hash:string;role:string;active:boolean;must_change_password:boolean}>(
      'SELECT id,full_name,email,password_hash,role,active,must_change_password FROM users WHERE email=$1 LIMIT 1',[normalized]);
    const valid=Boolean(user?.active && await checkPassword(password,user.password_hash));
    await sql('INSERT INTO login_history(user_id,email,success) VALUES($1,$2,$3)',[user?.id||null,normalized,valid]);
    if(!valid) return json({error:'Invalid credentials'},401);
    const response=json({user:{id:user!.id,full_name:user!.full_name,email:user!.email,role:user!.role,must_change_password:user!.must_change_password}});
    await createSession(user!.id,response);
    return response;
  } catch(error) {
    if(error instanceof HttpError) return json({error:error.message},error.status);
    if(error instanceof SyntaxError) return json({error:'Email and password required'},400);
    console.error('[login] failed',error);
    return json({error:'Unable to sign in'},500);
  }
}
