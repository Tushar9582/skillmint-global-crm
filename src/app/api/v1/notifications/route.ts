import { api, json, body } from '@/lib/http';
import { sql } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { UUID } from '@/lib/records';

export const GET=api(async(_request,actor)=>json({data:await sql(
  `SELECT * FROM notifications WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,
  [actor.organization_id,actor.id])}));

export const PATCH=api(async(request,actor)=>{
  const data=await body(request);
  const id=String(data.id||'');
  if(!UUID.test(id)) throw new HttpError(400,'Invalid notification');
  await sql('UPDATE notifications SET read_at=now() WHERE id=$1 AND organization_id=$2 AND user_id=$3',
    [id,actor.organization_id,actor.id]);
  return json({ok:true});
});
