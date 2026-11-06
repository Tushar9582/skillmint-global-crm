import { NextResponse } from 'next/server';
import { api } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { one } from '@/lib/db';
import { UUID } from '@/lib/records';
import { downloadResume } from '@/lib/storage';

export const GET=api(async(request,actor)=>{
  const id=request.nextUrl.pathname.split('/')[4];
  if(!UUID.test(id)) throw new HttpError(404,'Resume not found');
  const doc=await one<{storage_key:string;original_filename:string;mime_type:string;owner_id:string}>(
    `SELECT r.storage_key,r.original_filename,r.mime_type,c.owner_id FROM resume_versions r
     JOIN candidates c ON c.id=r.candidate_id AND c.organization_id=r.organization_id
     WHERE r.id=$1 AND r.organization_id=$2`,[id,actor.organization_id]);
  if(!doc || (actor.role!=='admin' && actor.id!==doc.owner_id)) throw new HttpError(404,'Resume not found');
  const result=await downloadResume(doc.storage_key);
  if(result.url) return NextResponse.redirect(result.url,303);
  const safeName=doc.original_filename.replace(/[\r\n"\\]/g,'_').slice(0,120);
  return new NextResponse(new Uint8Array(result.bytes!),{
    headers:{'Content-Type':doc.mime_type,'Content-Disposition':`attachment; filename="${safeName}"`,
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
  });
});
