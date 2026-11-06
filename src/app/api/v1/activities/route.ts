import { api, body, json } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getRecord, UUID } from '@/lib/records';
import { one, sql, transaction } from '@/lib/db';
import { activeValues } from '@/lib/crm-config';

const targetMap:Record<string,string>={company_leads:'company-leads',candidates:'candidates',applications:'applications'};
export const POST=api(async(request,actor)=>{
  const data=await body(request);
  const type=String(data.target_type||'');
  const target=String(data.target_id||'');
  const channel=String(data.channel||'');
  const outcome=String(data.outcome||'').trim();
  const notes=String(data.notes||'').trim();
  const due=data.next_due_at ? String(data.next_due_at) : null;
  if(!targetMap[type]||!UUID.test(target)) throw new HttpError(400,'Invalid related record');
  if(!(await activeValues(actor.organization_id,'followup_type')).includes(channel)||!outcome) throw new HttpError(400,'Channel and outcome required');
  if(notes.length>5000) throw new HttpError(400,'Notes too long');
  if(due&&!Number.isFinite(new Date(due).getTime())) throw new HttpError(400,'Invalid next follow-up date');
  return json({data:await transaction(async client=>{
    await getRecord(actor,targetMap[type],target,client);
    const created=await one(
      `INSERT INTO activities(organization_id,target_type,target_id,actor_id,channel,outcome,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at`,
      [actor.organization_id,type,target,actor.id,channel,outcome,notes],client);
    if(due) await sql(
      `INSERT INTO followups(organization_id,target_type,target_id,owner_id,due_at,title,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [actor.organization_id,type,target,actor.id,due,`Follow up: ${outcome}`,actor.id],client);
    await audit(actor,'activity_logged',type,target,{channel,outcome},client);
    return created;
  })},201);
});

export const GET=api(async(request,actor)=>{
  const type=request.nextUrl.searchParams.get('target_type')||'';
  const target=request.nextUrl.searchParams.get('target_id')||'';
  if(type || target) {
    if(!targetMap[type]||!UUID.test(target)) throw new HttpError(400,'Invalid target');
    await getRecord(actor,targetMap[type],target);
  }
  const params:unknown[]=[actor.organization_id];
  let filter='WHERE a.organization_id=$1';
  if(actor.role!=='admin') {params.push(actor.id);filter+=` AND a.actor_id=$${params.length}`;}
  if(type && target) {params.push(type,target);filter+=` AND a.target_type=$${params.length-1} AND a.target_id=$${params.length}`;}
  const rows=await sql(
    `SELECT a.*,u.full_name AS employee_name FROM activities a JOIN users u ON u.id=a.actor_id
     ${filter} ORDER BY a.created_at DESC LIMIT 100`,params);
  return json({data:rows});
});
