import { NextRequest } from 'next/server';
import { assertSameOrigin,HttpError } from '@/lib/auth';
import { body,json } from '@/lib/http';
import { platformOverview,platformCompany,changeWorkspaceAccess } from '@/lib/saas-platform';
export const dynamic='force-dynamic';
function failure(error:unknown){if(error instanceof HttpError)return json({error:error.message},error.status);console.error('[platform] request failed');return json({error:'Unable to complete platform action.'},500);}
export async function GET(request:NextRequest){
  try {const id=request.nextUrl.searchParams.get('company');return json(id?await platformCompany(id):await platformOverview());}
  catch(error){return failure(error);}
}
export async function PATCH(request:NextRequest){
  try {assertSameOrigin(request);const input=await body(request);await changeWorkspaceAccess(String(input.companyId||''),input);return json({ok:true});}
  catch(error){return failure(error);}
}
