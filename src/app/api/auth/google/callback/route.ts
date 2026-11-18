import {NextRequest,NextResponse} from 'next/server';
import {authPost,verifiedIdentity,companyAccount,signupEnabled,registrationIntakeEnabled} from '@/lib/company-auth';
import {createSession} from '@/lib/auth';
import {clearOwnerCookie} from '@/lib/platform-auth';
import {one} from '@/lib/db';
const origin=()=>new URL(process.env.APP_ORIGIN||'https://skillmintcrm.netlify.app').origin;
function redirect(path:string){const r=NextResponse.redirect(new URL(path,origin()));r.cookies.set('hd_google_pkce','',{path:'/api/auth/google/callback',maxAge:0});return r;}
export async function GET(request:NextRequest){
 try{
  if(!registrationIntakeEnabled())return redirect('/login?google=closed');
  const code=request.nextUrl.searchParams.get('code'),verifier=request.cookies.get('hd_google_pkce')?.value;
  if(!code||!verifier)return redirect('/login?google=failed');
  const a=await authPost('/token?grant_type=pkce',{auth_code:code,code_verifier:verifier});
  const token=a.result.access_token;
  if(!a.ok)return redirect('/login?google=failed');
  const identity=await verifiedIdentity(token);if(!identity)return redirect('/login?google=failed');
  if(await one('SELECT auth_user_id FROM hrdiary_auth_platform_owner WHERE auth_user_id=$1',[identity.id]))return redirect('/login');
  const row=await one('SELECT user_id FROM hrdiary_admin_identities WHERE auth_user_id=$1',[identity.id]);
  if(row){
   if(!signupEnabled())return redirect('/login?google=activation');
   const user=await companyAccount(identity);
   const response=redirect('/dashboard');await createSession(user.id,response);clearOwnerCookie(response);return response;
  }
  if(await one('SELECT id FROM users WHERE lower(email)=lower($1)',[identity.email]))return redirect('/login?google=existing');
  const response=redirect('/register/google');
  response.cookies.set('hd_google_setup',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:600});
  return response;
 }catch{return redirect('/login?google=failed');}
}
