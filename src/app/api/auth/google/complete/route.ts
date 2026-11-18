import {NextRequest} from 'next/server';
import {assertSameOrigin,HttpError} from '@/lib/auth';
import {body,json} from '@/lib/http';
import {one,sql} from '@/lib/db';
import {verifiedIdentity,companyFields,signupEnabled,registrationIntakeEnabled,companyAccount} from '@/lib/company-auth';
export async function POST(request:NextRequest){
 try{
  assertSameOrigin(request);
  if(!registrationIntakeEnabled())return json({error:'Registration closed'},503);
  const identity=await verifiedIdentity(request.cookies.get('hd_google_setup')?.value);
  if(!identity)return json({error:'Google session expired. Continue with Google again.'},401);
  if(await one('SELECT auth_user_id FROM hrdiary_auth_platform_owner WHERE auth_user_id=$1',[identity.id]))return json({error:'Use Super Admin sign in.'},403);
  if(await one('SELECT id FROM users WHERE lower(email)=lower($1)',[identity.email]))return json({error:'Use your existing login.'},409);
  const d=await body(request),fields=companyFields(d.fullName,d.companyName);
  await sql("INSERT INTO hrdiary_signup_requests(full_name,company_name,email) VALUES($1,$2,lower($3)) ON CONFLICT DO NOTHING",[fields.name,fields.company,identity.email]);
  if(signupEnabled())await companyAccount(identity,fields);
  const r=json({message:signupEnabled()?'Company account created. Sign in with Google.':'Registration saved. Workspace activation is pending security configuration.'},201);
  r.cookies.set('hd_google_setup','',{path:'/',maxAge:0});return r;
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);return json({error:'Unable to finish registration.'},500);}
}
