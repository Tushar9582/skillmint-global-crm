import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { assertSameOrigin, hashPassword, hashToken, HttpError, normalizeEmail } from '@/lib/auth';
import { body, json } from '@/lib/http';
import { one, sql, transaction } from '@/lib/db';
import { registrationEnabled } from '@/lib/tenant-context';

export async function POST(request:NextRequest){
  try {
    if(!registrationEnabled()||!process.env.RESEND_API_KEY||!process.env.SAAS_FROM_EMAIL)
      return json({error:'Registration is not available yet.'},404);
    assertSameOrigin(request);
    const data=await body(request);
    const email=normalizeEmail(typeof data.email==='string'?data.email:'');
    if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid work email.');
    if(data.action==='request'){
      const token=randomBytes(32).toString('hex');
      const issued=await transaction(async client=>{
        await client.query('SELECT pg_advisory_xact_lock(183716927)');
        const c=await one<{total:number;per_email:number}>(`SELECT count(*)::int total,
          count(*) FILTER(WHERE email=$1)::int per_email FROM saas_registration_invites WHERE created_at>now()-interval '1 hour'`,[email],client);
        if((c?.total??0)>=100||(c?.per_email??0)>=3)throw new HttpError(429,'Too many verification requests. Try again later.');
        if(await one('SELECT id FROM users WHERE email=$1',[email],client))return false;
        await sql("INSERT INTO saas_registration_invites(token_hash,email,expires_at) VALUES($1,$2,now()+interval '30 minutes')",[hashToken(token),email],client);
        return true;
      });
      if(issued){
        const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({
          from:process.env.SAAS_FROM_EMAIL,to:[email],subject:'Verify your SkillMint workspace',
          text:'Paste this verification code into SkillMint. It expires in 30 minutes.\n\n'+token+'\n\nIf you did not request this, ignore this email.'}),signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new HttpError(503,'Email delivery is temporarily unavailable.');
      }
      return json({message:'If this address is eligible, a verification code has been sent.'});
    }
    if(data.action!=='complete')throw new HttpError(400,'Unknown registration action.');
    const name=typeof data.fullName==='string'?data.fullName.trim():'',company=typeof data.companyName==='string'?data.companyName.trim():'';
    const password=typeof data.password==='string'?data.password:'',token=typeof data.code==='string'?data.code.trim():'';
    if(!name||name.length>150||!company||company.length>150||password.length<12||Buffer.byteLength(password,'utf8')>72)
      throw new HttpError(400,'Enter your name, company and a unique password (12 characters minimum, 72 UTF-8 bytes maximum).');
    if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(400,'Enter the code from your email.');
    const digest=hashToken(token);
    if(!await one('SELECT token_hash FROM saas_registration_invites WHERE token_hash=$1 AND email=$2 AND used_at IS NULL AND expires_at>now()',[digest,email]))
      throw new HttpError(400,'Verification code is invalid or expired.');
    const hash=await hashPassword(password);
    await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(183716928,hashtext($1))',[email]);
      if(!await one('UPDATE saas_registration_invites SET used_at=now() WHERE token_hash=$1 AND email=$2 AND used_at IS NULL AND expires_at>now() RETURNING token_hash',[digest,email],client))
        throw new HttpError(400,'Verification code is invalid or expired.');
      if(await one('SELECT id FROM users WHERE email=$1',[email],client))throw new HttpError(409,'Use sign in or contact support.');
      const org=await one<{id:string}>('INSERT INTO organizations(name) VALUES($1) RETURNING id',[company],client);
      if(!org)throw Error('Workspace creation failed');
      await sql("INSERT INTO users(organization_id,full_name,email,password_hash,role,active,must_change_password) VALUES($1,$2,$3,$4,'admin',true,false)",[org.id,name,email,hash],client);
      await sql("INSERT INTO saas_workspace_access(organization_id,status,trial_ends_at) VALUES($1,'trial',now()+interval '3 days')",[org.id],client);
      await sql('UPDATE saas_registration_invites SET used_at=now() WHERE email=$1 AND used_at IS NULL',[email],client);
    });
    return json({message:'Your workspace is ready. Sign in to start your trial.'},201);
  }catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    if(error instanceof SyntaxError)return json({error:'Invalid request.'},400);
    if((error as {code?:string})?.code==='23505')return json({error:'Unable to register. Use sign in or contact support.'},409);
    console.error('[saas registration] failed');
    return json({error:'Unable to create your workspace. Try again later.'},500);
  }
}
