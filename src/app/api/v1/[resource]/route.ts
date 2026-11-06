import type { NextRequest } from 'next/server';
import { api, body, json, pageLimit } from '@/lib/http';
import { createRecord, listRecords } from '@/lib/records';

async function resourceFromRequest(request:NextRequest) {
  return request.nextUrl.pathname.split('/')[3];
}

export const GET=api(async(request,actor)=>{
  const resource=await resourceFromRequest(request);
  const {limit,offset,page}=pageLimit(request);
  const records=await listRecords(actor,resource,limit,offset,
    request.nextUrl.searchParams.get('q')||'',request.nextUrl.searchParams.get('stage')||'');
  return json({data:records,page,has_more:records.length===limit});
});

export const POST=api(async(request,actor)=>{
  const resource=await resourceFromRequest(request);
  const created=await createRecord(actor,resource,await body(request));
  return json({data:created},201);
});
