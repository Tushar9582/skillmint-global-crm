import { api, body, json } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { audit, notify } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { CATALOG } from '@/lib/catalog';
import { UUID } from '@/lib/records';
import { isLeadResource, parseAssignmentRange } from '@/lib/lead-operations';

const allowed=new Set(['company-leads','clients','jobs','candidates','applications','interviews']);

function matchingLeadWhere(resource:string,organizationId:string,search:string,stage:string){
  const params:unknown[]=[organizationId];
  let where=`r.organization_id=$1${resource==='company-leads'||resource==='candidates'?' AND r.deleted_at IS NULL':''}`;
  if(search){params.push(`%${search}%`);where+=` AND to_jsonb(r)::text ILIKE $${params.length}`;}
  if(stage){params.push(stage);where+=` AND r.stage=$${params.length}`;}
  return {where,params};
}

/** Allows the admin to preview the number of records matching current filters. */
export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const resource=request.nextUrl.searchParams.get('resource')||'';
  if(!isLeadResource(resource))throw new HttpError(400,'Choose company, candidate or application leads');
  const search=(request.nextUrl.searchParams.get('q')||'').trim().slice(0,100);
  const stage=(request.nextUrl.searchParams.get('stage')||'').trim().slice(0,100);
  const {where,params}=matchingLeadWhere(resource,actor.organization_id,search,stage);
  const count=await one<{total:number}>(`SELECT count(*)::integer AS total FROM ${CATALOG[resource].table} r WHERE ${where}`,params);
  return json({data:{total:Number(count?.total||0)}});
});

export const POST=api(async(request,actor)=>{
  ensureAdmin(actor);
  const data=await body(request);
  const resource=String(data.resource||'');
  const ids=Array.isArray(data.ids)?data.ids.map(String):[];
  const target=String(data.to_owner||'');
  const reason=String(data.reason||'Admin bulk assignment').trim().slice(0,500);
  if(!allowed.has(resource)) throw new HttpError(400,'Choose an assignable module');
  let range:ReturnType<typeof parseAssignmentRange>|null=null;
  if(data.range!==undefined){
    if(!isLeadResource(resource))throw new HttpError(400,'Range allocation is for lead modules only');
    try{range=parseAssignmentRange(data.range);}catch(error){throw new HttpError(400,(error as Error).message);}
  }
  if(range&&ids.length)throw new HttpError(400,'Choose either selected rows or a range');
  if(!range&&(!ids.length||ids.length>200||new Set(ids).size!==ids.length||!ids.every(id=>UUID.test(id))))
    throw new HttpError(400,'Choose 1–200 unique records');
  if(!UUID.test(target)) throw new HttpError(400,'Choose a recipient');
  const table=CATALOG[resource].table;
  const result=await transaction(async client=>{
    const owner=await one<{full_name:string}>('SELECT full_name FROM users WHERE id=$1 AND organization_id=$2 AND active=true',
      [target,actor.organization_id],client);
    if(!owner) throw new HttpError(400,'Recipient is not an active employee');
    const records=range?await (async()=>{
      const {where,params}=matchingLeadWhere(resource,actor.organization_id,range.search,range.stage);
      params.push(range.to-range.from+1,range.from-1);
      return sql<{id:string;owner_id:string|null}>(
        `SELECT r.id,r.owner_id FROM ${table} r WHERE ${where}
         ORDER BY r.created_at DESC,r.id DESC LIMIT $${params.length-1} OFFSET $${params.length} FOR UPDATE`,
        params,client);
    })():await sql<{id:string;owner_id:string|null}>(
      `SELECT id,owner_id FROM ${table} WHERE organization_id=$1 AND id=ANY($2::uuid[]) ${resource==='company-leads'||resource==='candidates'?'AND deleted_at IS NULL':''} FOR UPDATE`,
      [actor.organization_id,ids],client);
    const expected=range?range.to-range.from+1:ids.length;
    if(records.length!==expected)throw new HttpError(409,'Not enough matching records; refresh the list and check the selected range');
    const selectedIds=records.map(record=>record.id);
    const changed=records.filter(r=>r.owner_id!==target);
    if(changed.length) {
      await sql(`UPDATE ${table} SET owner_id=$1,updated_at=now()
                 WHERE organization_id=$2 AND id=ANY($3::uuid[])`,
        [target,actor.organization_id,changed.map(r=>r.id)],client);
      for(const record of changed)await sql(
        `INSERT INTO assignment_history(organization_id,entity_type,entity_id,from_owner,to_owner,changed_by,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [actor.organization_id,table,record.id,record.owner_id,target,actor.id,reason],client);
      if(['company_leads','candidates','applications'].includes(table)) for(const record of changed)await sql(
        `UPDATE followups SET owner_id=$1 WHERE organization_id=$2 AND target_type=$3
         AND target_id=$4 AND status='pending' AND owner_id IS NOT DISTINCT FROM $5::uuid`,
        [target,actor.organization_id,table,record.id,record.owner_id],client);
      await notify(actor.organization_id,target,'Bulk work assignment',
        `${changed.length} ${resource.replace('-', ' ')} record(s) have been assigned to you.`,
        `/${resource}`,client);
    }
    await audit(actor,'bulk_assign',table,null,{ids:selectedIds,range,recipient:target,changed:changed.length,reason},client);
    return {requested:expected,changed:changed.length,recipient:owner.full_name};
  });
  return json({data:result});
});
