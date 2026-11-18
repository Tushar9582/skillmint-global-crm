import {randomBytes} from 'node:crypto';
import {one,sql,transaction} from './db';
import {hashPassword,HttpError,isDevDemoMode,isDemoModeRequested,normalizeEmail} from './auth';
export const AUTH_BASE='https://nozhoxwloatjibejxker.supabase.co/auth/v1';
const key=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_KlIlXvtZTT1Ci5Ssh3K-xA_p-VWAtEE';
export const signupEnabled=()=>process.env.HRDIARY_SELF_SIGNUP_ENABLED==='true'&&process.env.HRDIARY_TENANT_RLS==='true'&&!isDemoModeRequested()&&!isDevDemoMode();
export const registrationIntakeEnabled=()=>process.env.HRDIARY_REGISTRATION_CLOSED!=='true'&&!isDemoModeRequested()&&!isDevDemoMode();
export type Identity={id:string;email?:string;email_confirmed_at?:string;user_metadata?:Record<string,unknown>};
export type CompanyLogin={id:string;full_name:string;email:string;role:'admin';active:boolean;must_change_password:boolean};
export async function authPost(path:string,data:Record<string,unknown>){
 const r=await fetch(AUTH_BASE+path,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(data),cache:'no-store',signal:AbortSignal.timeout(10000)});
 const result=await r.json().catch(()=>({}));return {ok:r.ok,result};
}
export async function verifiedIdentity(token:unknown):Promise<Identity|null>{
 if(typeof token!=='string'||token.length>8000)return null;
 const r=await fetch(AUTH_BASE+'/user',{headers:{apikey:key,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)return null;
 const u=await r.json() as Identity;return u.id&&u.email_confirmed_at&&normalizeEmail(u.email)?u:null;
}
export function companyFields(name:unknown,company:unknown){
 const n=typeof name==='string'?name.trim():'',c=typeof company==='string'?company.trim():'';
 if(!n||!c||n.length>150||c.length>150)throw new HttpError(400,'Enter your full name and company name.');
 return {name:n,company:c};
}
export async function companyAccount(identity:Identity,fields?:{name:string;company:string}):Promise<CompanyLogin>{
 if(!signupEnabled())throw new HttpError(503,'Company registration is not enabled.');
 const email=normalizeEmail(identity.email);if(!email||!identity.email_confirmed_at)throw new HttpError(403,'Verify your email first.');
 if(await one('SELECT auth_user_id FROM hrdiary_auth_platform_owner WHERE auth_user_id=$1',[identity.id]))throw new HttpError(403,'Use Super Admin sign in.');
 return transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(183716928,hashtext($1))',[email]);
  const existing=await one<CompanyLogin>(`SELECT u.id,u.full_name,u.email,u.role,u.active,u.must_change_password FROM hrdiary_admin_identities i JOIN users u ON u.id=i.user_id WHERE i.auth_user_id=$1 AND u.role='admin'`,[identity.id],client);
  if(existing){if(!existing.active)throw new HttpError(403,'Account disabled');return existing;}
  // Never attach a verified email to a pre-existing CRM account without a separate linking ceremony.
  if(await one('SELECT id FROM users WHERE lower(email)=$1',[email],client))throw new HttpError(409,'Use your existing CRM credentials. Contact support to link Google.');
  if(!fields)throw new HttpError(403,'Create your company workspace first.');
  const org=await one<{id:string}>('INSERT INTO organizations(name) VALUES($1) RETURNING id',[fields.company],client);
  if(!org)throw Error('Organization creation failed');
  const passwordHash=await hashPassword(randomBytes(32).toString('hex'));
  const user=await one<CompanyLogin>("INSERT INTO users(organization_id,full_name,email,password_hash,role,active,must_change_password) VALUES($1,$2,$3,$4,'admin',true,false) RETURNING id,full_name,email,role,active,must_change_password",[org.id,fields.name,email,passwordHash],client);
  if(!user)throw Error('Admin creation failed');
  await sql('INSERT INTO hrdiary_admin_identities(auth_user_id,user_id) VALUES($1,$2)',[identity.id,user.id],client);
  const pending=await one("UPDATE hrdiary_signup_requests SET status='approved',organization_id=$1,reviewed_at=now() WHERE lower(email)=$2 AND status='pending' RETURNING id",[org.id,email],client);
  if(!pending)await sql("INSERT INTO hrdiary_signup_requests(full_name,company_name,email,status,organization_id,reviewed_at) VALUES($1,$2,$3,'approved',$4,now())",[fields.name,fields.company,email,org.id],client);
  await sql(`INSERT INTO audit_events(organization_id,actor_id,action,entity_type,entity_id,details) VALUES($1,$2,'company_registration','organizations',$1,'{}'::jsonb)`,[org.id,user.id],client);
  return user;
 });
}
export async function verifiedPasswordLogin(email:string,password:string){
 const auth=await authPost('/token?grant_type=password',{email,password});
 if(!auth.ok)return null;
 const identity=await verifiedIdentity(auth.result.access_token);if(!identity)return null;
 if(!signupEnabled())throw new HttpError(403,'Your account is verified, but your company workspace is awaiting activation. Contact HrDiary support.');
 const meta=identity.user_metadata||{};
 const fields=typeof meta.hrdiary_company==='string'&&typeof meta.hrdiary_name==='string'?companyFields(meta.hrdiary_name,meta.hrdiary_company):undefined;
 const pending=await one<{full_name:string;company_name:string}>("SELECT full_name,company_name FROM hrdiary_signup_requests WHERE lower(email)=lower($1) AND status='pending' ORDER BY created_at DESC LIMIT 1",[identity.email]);
 return companyAccount(identity,pending?companyFields(pending.full_name,pending.company_name):fields);
}
