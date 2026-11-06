import { api, body, json } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { audit, notify } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { UUID } from '@/lib/records';

const transferTables=['company_leads','clients','jobs','candidates','applications','interviews'];

export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const id=request.nextUrl.searchParams.get('employee_id')||'';
  if(!UUID.test(id)) throw new HttpError(400,'Select an employee');
  const user=await one<{id:string;full_name:string;active:boolean}>(
    'SELECT id,full_name,active FROM users WHERE id=$1 AND organization_id=$2',[id,actor.organization_id]);
  if(!user) throw new HttpError(404,'Employee not found');
  const counts:Record<string,number>={};
  for(const table of transferTables) {
    const result=await one<{count:string}>(`SELECT count(*)::text AS count FROM ${table} WHERE organization_id=$1 AND owner_id=$2`,
      [actor.organization_id,id]);
    counts[table]=Number(result?.count||0);
  }
  const tasks=await one<{count:string}>(
    `SELECT count(*)::text AS count FROM followups WHERE organization_id=$1 AND owner_id=$2 AND status='pending'`,
    [actor.organization_id,id]);
  counts.followups=Number(tasks?.count||0);
  const reviews=await one<{count:string}>(
    `SELECT count(*)::text AS count FROM duplicate_reviews WHERE organization_id=$1 AND owner_id=$2 AND status='pending'`,
    [actor.organization_id,id]);
  counts.duplicate_reviews=Number(reviews?.count||0);
  return json({employee:user,counts,total:Object.values(counts).reduce((a,b)=>a+b,0)});
});

export const POST=api(async(request,actor)=>{
  ensureAdmin(actor);
  const data=await body(request);
  const from=String(data.from_user||'');
  const to=String(data.to_user||'');
  const reason=String(data.reason||'Employee exit / reassignment').trim();
  if(!UUID.test(from)||!UUID.test(to)||from===to) throw new HttpError(400,'Choose two different employees');
  if(from===actor.id) throw new HttpError(400,'Use another Admin to reassign the current Admin');

  const result=await transaction(async client=>{
    const people=await sql<{id:string;active:boolean;role:string}>(
      `SELECT id,active,role FROM users WHERE organization_id=$1 AND id=ANY($2::uuid[])
       ORDER BY id FOR UPDATE`,[actor.organization_id,[from,to]],client);
    const departed=people.find(p=>p.id===from);
    const replacement=people.find(p=>p.id===to);
    if(!departed?.active || !replacement?.active || departed.role==='admin')
      throw new HttpError(400,'Both users must exist, and the departing user must be an active employee');
    const batch=await one<{id:string}>(
      `INSERT INTO handover_batches(organization_id,from_user,to_user,actor_id)
       VALUES($1,$2,$3,$4) RETURNING id`,[actor.organization_id,from,to,actor.id],client);
    if(!batch) throw new HttpError(500,'Unable to start handover');
    const counts:Record<string,number>={};
    for(const table of transferTables) {
      const moved=await sql<{id:string}>(
        `UPDATE ${table} SET owner_id=$1,updated_at=now()
         WHERE organization_id=$2 AND owner_id=$3 RETURNING id`,[to,actor.organization_id,from],client);
      counts[table]=moved.length;
      if(moved.length) await sql(
        `INSERT INTO assignment_history(organization_id,entity_type,entity_id,from_owner,to_owner,changed_by,reason,batch_id)
         SELECT $1,$2,UNNEST($3::uuid[]),$4,$5,$6,$7,$8`,
        [actor.organization_id,table,moved.map(r=>r.id),from,to,actor.id,reason,batch.id],client);
    }
    const tasks=await sql<{id:string}>(
      `UPDATE followups SET owner_id=$1 WHERE organization_id=$2 AND owner_id=$3 AND status='pending' RETURNING id`,
      [to,actor.organization_id,from],client);
    counts.followups=tasks.length;
    const reviews=await sql<{id:string}>(
      `UPDATE duplicate_reviews SET owner_id=$1 WHERE organization_id=$2 AND owner_id=$3 AND status='pending' RETURNING id`,
      [to,actor.organization_id,from],client);
    counts.duplicate_reviews=reviews.length;
    await sql(`UPDATE handover_batches SET lead_count=$1,candidate_count=$2,application_count=$3,followup_count=$4 WHERE id=$5`,
      [counts.company_leads,counts.candidates,counts.applications,counts.followups,batch.id],client);
    await sql('UPDATE users SET active=false,updated_at=now() WHERE id=$1',[from],client);
    await sql('DELETE FROM sessions WHERE user_id=$1',[from],client);
    await notify(actor.organization_id,to,'Work handover received',
      `Records transferred from your colleague. ${Object.values(counts).reduce((a,b)=>a+b,0)} assignments updated.`,
      '/dashboard',client);
    await audit(actor,'employee_handover','users',from,{batch_id:batch.id,to_user:to,counts,reason},client);
    return {batch_id:batch.id,counts,disabled_user_id:from,receiving_user_id:to};
  });
  return json({data:result});
});
