import {NextRequest} from 'next/server';
import {assertSameOrigin,HttpError,normalizeEmail} from '@/lib/auth';
import {body,json} from '@/lib/http';
import {authPost,registrationIntakeEnabled} from '@/lib/company-auth';
export async function POST(request:NextRequest){
 try{
  assertSameOrigin(request);
  if(!registrationIntakeEnabled())return json({error:'Verification temporarily unavailable'},503);
  const d=await body(request),email=normalizeEmail(typeof d.email==='string'?d.email:'');
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a valid email address'},400);
  const origin=process.env.APP_ORIGIN||'https://skillmintcrm.netlify.app';
  const r=await authPost('/resend?redirect_to='+encodeURIComponent(new URL('/login',origin).href),{type:'signup',email});
  if(r.status===429)return json({error:'Email rate limit reached. Try again later.'},429);
  if(!r.ok&&r.status>=500)return json({error:'Email delivery unavailable. Contact support.'},503);
  return json({message:'If your account is awaiting verification, check your inbox and spam folder for the confirmation email.'});
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);return json({error:'Unable to request verification email'},503);}
}
