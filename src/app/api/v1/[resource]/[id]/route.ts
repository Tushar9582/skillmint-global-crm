import { api, body, json } from '@/lib/http';
import { archiveRecord, getRecord, restoreRecord, updateRecord } from '@/lib/records';

function ids(path:string) {
  const parts=path.split('/');
  return {resource:parts[3],id:parts[4]};
}

export const GET=api(async(request,actor)=>{
  const {resource,id}=ids(request.nextUrl.pathname);
  return json({data:await getRecord(actor,resource,id)});
});

export const PATCH=api(async(request,actor)=>{
  const {resource,id}=ids(request.nextUrl.pathname);
  return json({data:await updateRecord(actor,resource,id,await body(request))});
});
export const DELETE=api(async(request,actor)=>{const {resource,id}=ids(request.nextUrl.pathname);await archiveRecord(actor,resource,id);return json({ok:true,message:'Lead deleted successfully.'});});
export const POST=api(async(request,actor)=>{const {resource,id}=ids(request.nextUrl.pathname);if(request.nextUrl.searchParams.get('action')!=='restore') return json({error:'Unknown action'},400);await restoreRecord(actor,resource,id);return json({ok:true,message:'Lead restored successfully.'});});
