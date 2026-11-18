import { NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { revokeSession,assertSameOrigin,HttpError } from '@/lib/auth';
import {clearOwnerCookie} from '@/lib/platform-auth';

export async function POST(_request:NextRequest) {
  try{assertSameOrigin(_request);}catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);throw e;}
  const response=json({ok:true});
  await revokeSession(response);
  clearOwnerCookie(response);
  return response;
}
