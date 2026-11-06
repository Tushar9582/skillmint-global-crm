import { api, body, json } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { UUID } from '@/lib/records';
import { activeValues } from '@/lib/crm-config';

export const POST=api(async(request,actor)=>{
  const id=request.nextUrl.pathname.split('/')[4];
  if(!UUID.test(id)) throw new HttpError(400,'Invalid follow-up');
  const data=await body(request);
  const channel=String(data.channel||'').trim();
  const outcome=String(data.outcome||'').trim();
  const notes=String(data.notes||'').trim();
  const nextDue=data.next_due_at ? String(data.next_due_at) : null;
  if(!(await activeValues(actor.organization_id,'followup_type')).includes(channel)) throw new HttpError(400,'Choose a communication channel');
  if(!outcome || outcome.length>120) throw new HttpError(400,'Outcome is required');
  if(notes.length>5000) throw new HttpError(400,'Notes are too long');
  if(nextDue && !Number.isFinite(new Date(nextDue).valueOf())) throw new HttpError(400,'Invalid next follow-up date');
  const result=await transaction(async client=>{
    const task=await one<{id:string;owner_id:string;status:string;target_type:string;target_id:string;title:string}>(
      'SELECT * FROM followups WHERE id=$1 AND organization_id=$2 FOR UPDATE',[id,actor.organization_id],client);
    if(!task || (actor.role!=='admin' && task.owner_id!==actor.id)) throw new HttpError(404,'Follow-up not found');
    if(task.status!=='pending') throw new HttpError(409,'Follow-up was already completed');
    await sql(
      `UPDATE followups SET status='done',channel=$1,outcome=$2,notes=$3,completed_by=$4,completed_at=now()
       WHERE id=$5`,[channel,outcome,notes,actor.id,id],client);
    await sql(
      `INSERT INTO activities(organization_id,target_type,target_id,actor_id,channel,outcome,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [actor.organization_id,task.target_type,task.target_id,actor.id,channel,outcome,notes],client);
    if(nextDue) await sql(
      `INSERT INTO followups(organization_id,target_type,target_id,owner_id,due_at,title,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [actor.organization_id,task.target_type,task.target_id,task.owner_id,nextDue,task.title,actor.id],client);
    if(task.target_type==='company_leads') {
      await sql('UPDATE company_leads SET last_contacted_at=now(),next_followup_at=$1,updated_at=now() WHERE id=$2 AND organization_id=$3',
        [nextDue,task.target_id,actor.organization_id],client);
    }
    await audit(actor,'followup_complete','followups',id,{channel,outcome,has_next:!!nextDue},client);
    return {id,status:'done',next_due_at:nextDue};
  });
  return json({data:result});
});
