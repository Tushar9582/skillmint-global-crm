import {NextRequest} from 'next/server';
import {assertSameOrigin,HttpError} from '@/lib/auth';
import {json,body} from '@/lib/http';
import {signInOwner,OWNER_COOKIE} from '@/lib/platform-auth';
export async function POST(request:NextRequest){
 try{
  assertSameOrigin(request);
  const d=await body(request);
  if(d.action==='logout'){const r=json({ok:true});r.cookies.set(OWNER_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:0});return r;}
  if(typeof d.email!=='string'||typeof d.password!=='string'||d.email.length>254||!d.password||d.password.length>256)return json({error:'Enter valid credentials'},400);
  const session=await signInOwner(d.email.trim().toLowerCase(),d.password);
  if(!session)return json({error:'Invalid Super Admin credentials'},401);
  const r=json({ok:true});r.cookies.set(OWNER_COOKIE,session.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:session.ttl});return r;
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);return json({error:'Super Admin sign in unavailable'},503);}
}
