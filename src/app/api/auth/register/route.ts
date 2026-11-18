import {NextRequest} from 'next/server';
import {assertSameOrigin,HttpError,normalizeEmail} from '@/lib/auth';
import {body,json} from '@/lib/http';
import {one,sql,transaction} from '@/lib/db';
import {authPost,companyFields,signupEnabled} from '@/lib/company-auth';
export async function POST(request:NextRequest){
 try{
  if(!signupEnabled())return json({error:'Company signup is not enabled yet. Contact HrDiary support.'},503);
  assertSameOrigin(request);
  const d=await body(request);
  const fields=companyFields(d.fullName,d.companyName);
  const email=normalizeEmail(typeof d.email==='string'?d.email:'');
  const password=typeof d.password==='string'?d.password:'';
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||Buffer.byteLength(password,'utf8')>72)throw new HttpError(400,'Valid email and a password of 12–72 UTF-8 bytes required.');
  await transaction(async client=>{
   await client.query('SELECT pg_advisory_xact_lock(183716927)');
   const rate=await one<{n:number}>("SELECT count(*)::int n FROM hrdiary_registration_attempts WHERE created_at>now()-interval '1 hour'",[],client);
   if((rate?.n||0)>=100)throw new HttpError(429,'Too many registration requests. Try later.');
   await sql('INSERT INTO hrdiary_registration_attempts DEFAULT VALUES',[],client);
  });
  if(await one("SELECT id FROM users WHERE lower(email)=$1 UNION ALL SELECT a.auth_user_id FROM hrdiary_auth_platform_owner a JOIN auth.users u ON u.id=a.auth_user_id WHERE lower(u.email)=$1",[email]))return json({message:'If eligible, check your email to verify your account and then sign in.'});
  const origin=process.env.APP_ORIGIN||'https://skillmintcrm.netlify.app';
  const a=await authPost('/signup?redirect_to='+encodeURIComponent(new URL('/login',origin).href),{email,password,data:{hrdiary_name:fields.name,hrdiary_company:fields.company}});
  if(!a.ok)return json({error:'Registration could not be completed. Try again or use sign in.'},400);
  await sql("INSERT INTO hrdiary_signup_requests(full_name,company_name,email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[fields.name,fields.company,email]);
  return json({message:'Check your email to verify your account, then sign in.'},201);
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);return json({error:'Unable to register right now.'},500);}
}
