import { NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { revokeSession } from '@/lib/auth';

export async function POST(_request:NextRequest) {
  const response=json({ok:true});
  await revokeSession(response);
  return response;
}
