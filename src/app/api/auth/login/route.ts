import { NextRequest } from 'next/server';
import { assertSameOrigin, checkPassword, createSession, HttpError, normalizeEmail } from '@/lib/auth';
import { one, sql } from '@/lib/db';
import { json } from '@/lib/http';

export async function POST(request:NextRequest) {
  try {
    assertSameOrigin(request);
    const {email,password}=await request.json();
    const normalized=normalizeEmail(String(email||''));
    if(!normalized || typeof password!=='string' || !password) return json({error:'Email and password required'},400);
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
    console.error('[login] failed',error);
    return json({error:'Unable to sign in'},500);
  }
}
