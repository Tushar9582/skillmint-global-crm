import {createHash,randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {AUTH_BASE,registrationIntakeEnabled} from '@/lib/company-auth';
const origin=()=>new URL(process.env.APP_ORIGIN||'https://skillmintcrm.netlify.app').origin;
export async function GET(request:NextRequest){
 if(!registrationIntakeEnabled())return NextResponse.redirect(new URL('/login?google=closed',origin()));
 const verifier=randomBytes(48).toString('base64url');
 const target=new URL(AUTH_BASE+'/authorize');
 target.searchParams.set('provider','google');
 target.searchParams.set('redirect_to',origin()+'/api/auth/google/callback');
 target.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));
 target.searchParams.set('code_challenge_method','s256');
 target.searchParams.set('prompt','select_account');
 const response=NextResponse.redirect(target);
 response.cookies.set('hd_google_pkce',verifier,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/auth/google/callback',maxAge:600});
 return response;
}
