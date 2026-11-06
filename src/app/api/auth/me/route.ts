import { api, body, json } from '@/lib/http';
import { checkPassword, hashPassword, HttpError } from '@/lib/auth';
import { one, sql } from '@/lib/db';

export const GET=api(async(_request,actor)=>json({user:actor}));

export const PATCH=api(async(request,actor)=>{
  const payload=await body(request);
  const current=String(payload.current_password||'');
  const changed=String(payload.new_password||'');
  if(changed.length<12 || changed.length>128) throw new HttpError(400,'New password must be at least 12 characters');
  const user=await one<{password_hash:string}>('SELECT password_hash FROM users WHERE id=$1',[actor.id]);
  if(!user || !(await checkPassword(current,user.password_hash))) throw new HttpError(400,'Current password is incorrect');
  await sql('UPDATE users SET password_hash=$1,must_change_password=false,updated_at=now() WHERE id=$2',
    [await hashPassword(changed),actor.id]);
  await sql('DELETE FROM sessions WHERE user_id=$1',[actor.id]);
  return json({ok:true});
});
