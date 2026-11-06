import { api, body, json } from '@/lib/http';
import { ensureAdmin, hashPassword, HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, transaction, sql } from '@/lib/db';
import { UUID } from '@/lib/records';

export const PATCH=api(async(request,actor)=>{
  ensureAdmin(actor);
  const id=request.nextUrl.pathname.split('/')[4];
  if(!UUID.test(id)) throw new HttpError(400,'Invalid employee');
  const data=await body(request);
  const updates:string[]=[];
  const args:unknown[]=[];
  if(typeof data.full_name==='string' && data.full_name.trim()) {updates.push(`full_name=$${args.length+1}`);args.push(data.full_name.trim());}
  if(typeof data.team==='string') {updates.push(`team=$${args.length+1}`);args.push(data.team.trim());}
  if(typeof data.temporary_password==='string') {
    if(data.temporary_password.length<12) throw new HttpError(400,'Temporary password must be at least 12 characters');
    updates.push(`password_hash=$${args.length+1}`);args.push(await hashPassword(data.temporary_password));
    updates.push('must_change_password=true');
  }
  if(!updates.length) throw new HttpError(400,'No employee changes provided');
  const employee=await transaction(async client=>{
    const existing=await one('SELECT id FROM users WHERE id=$1 AND organization_id=$2',[id,actor.organization_id],client);
    if(!existing) throw new HttpError(404,'Employee not found');
    const result=await one(
      `UPDATE users SET ${updates.join(',')},updated_at=now() WHERE id=$${args.length+1} AND organization_id=$${args.length+2}
       RETURNING id,full_name,email,team,active`,[...args,id,actor.organization_id],client);
    if(data.temporary_password) await sql('DELETE FROM sessions WHERE user_id=$1',[id],client);
    await audit(actor,'employee_update','users',id,{fields:Object.keys(data)},client);
    return result;
  });
  return json({data:employee});
});
