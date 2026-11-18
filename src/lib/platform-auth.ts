import {cookies} from 'next/headers';
import {one} from './db';
export const OWNER_COOKIE='hrdiary_owner_session';
const base='https://nozhoxwloatjibejxker.supabase.co/auth/v1';
// Publishable key only; not a service-role or database secret.
const key=process.env.SUPABASE_PUBLISHABLE_KEY||'sb_publishable_KlIlXvtZTT1Ci5Ssh3K-xA_p-VWAtEE';
export async function ownerFromToken(token:string|undefined){
 if(!token||token.length>8000)return null;
 const response=await fetch(base+'/user',{headers:{apikey:key,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;
 const user=await response.json() as {id?:string;email?:string;email_confirmed_at?:string};
 if(!user.id||!user.email_confirmed_at)return null;
 const owner=await one('SELECT auth_user_id FROM hrdiary_auth_platform_owner WHERE auth_user_id=$1',[user.id]);
 return owner?{id:user.id,email:user.email||'Platform owner'}:null;
}
export async function currentOwner(){return ownerFromToken((await cookies()).get(OWNER_COOKIE)?.value);}
export async function signInOwner(email:string,password:string){
 const response=await fetch(base+'/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password}),cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;
 const session=await response.json() as {access_token?:string;expires_in?:number};
 if(!session.access_token||!await ownerFromToken(session.access_token))return null;
 return {token:session.access_token,ttl:Math.min(3600,Math.max(1,Number(session.expires_in)||3600))};
}
