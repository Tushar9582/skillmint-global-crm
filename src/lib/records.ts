import type { PoolClient } from 'pg';
import { CATALOG, type Field } from './catalog';
import type { Actor } from './auth';
import { ensureAdmin, HttpError, normalizeEmail, normalizePhone } from './auth';
import { audit, notify } from './audit';
import { one, sql, transaction } from './db';
import { customFieldDefs, optionValuesFor } from './crm-config';
import { validateCustomValues, type CustomFieldDef } from './hr/crm-config';

type Row=Record<string,unknown>;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function definition(resource: string) {
  const def=CATALOG[resource];
  if(!def) throw new HttpError(404,'Unknown CRM resource');
  return def;
}
function supportsArchive(resource:string){return resource==='company-leads'||resource==='candidates';}
const customDefsFor=(orgId:string,resource:string)=>resource==='company-leads'?customFieldDefs(orgId,'company_leads'):resource==='candidates'?customFieldDefs(orgId,'candidates'):Promise.resolve(undefined);

const JOIN_SQL:Record<string,string>={
  jobs:'LEFT JOIN clients c ON c.id=r.client_id AND c.organization_id=r.organization_id',
  applications:`LEFT JOIN candidates ca ON ca.id=r.candidate_id AND ca.organization_id=r.organization_id
                LEFT JOIN jobs j ON j.id=r.job_id AND j.organization_id=r.organization_id`,
  interviews:`LEFT JOIN applications a ON a.id=r.application_id AND a.organization_id=r.organization_id
              LEFT JOIN candidates ca ON ca.id=a.candidate_id AND ca.organization_id=r.organization_id
              LEFT JOIN jobs j ON j.id=a.job_id AND j.organization_id=r.organization_id`,
};
const EXTRA_SQL:Record<string,string>={
  jobs:',c.company_name AS client_name',
  applications:',ca.full_name AS candidate_name,j.title AS job_title',
  interviews:',ca.full_name AS candidate_name,j.title AS job_title',
};

function selectClause(resource:string):string {
  return `SELECT r.*,u.full_name AS owner_name ${EXTRA_SQL[resource] || ''} FROM ${definition(resource).table} r
          LEFT JOIN users u ON u.id=r.owner_id ${JOIN_SQL[resource] || ''}`;
}

function visibility(actor:Actor):string {
  return actor.role==='admin' ? '' : 'AND r.owner_id=$2';
}

export async function listRecords(actor:Actor,resource:string,limit=50,offset=0,search='',stage=''):Promise<Row[]> {
  const def=definition(resource);
  const params:unknown[]=[actor.organization_id];
  if(actor.role!=='admin') params.push(actor.id);
  let condition=`WHERE r.organization_id=$1 ${visibility(actor)}${supportsArchive(resource)?' AND r.deleted_at IS NULL':''}`;
  if(search.trim()) {
    params.push(`%${search.trim().slice(0,100)}%`);
    condition+=` AND (to_jsonb(r)::text ILIKE $${params.length})`;
  }
  if(stage && ((await optionValuesFor(actor.organization_id,resource,true)).stage ?? def.stages ?? []).includes(stage)) {
    params.push(stage);
    condition+=` AND r.stage=$${params.length}`;
  }
  params.push(limit,offset);
  return sql<Row>(`${selectClause(resource)} ${condition} ORDER BY r.created_at DESC,r.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
}

export async function getRecord(actor:Actor,resource:string,id:string,client?:PoolClient):Promise<Row> {
  if(!UUID.test(id)) throw new HttpError(404,'Record not found');
  const rows=await sql<Row>(
    `${selectClause(resource)} WHERE r.organization_id=$1 AND r.id=$2 ${supportsArchive(resource)?'AND r.deleted_at IS NULL':''} ${actor.role==='admin'?'':'AND r.owner_id=$3'}`,
    actor.role==='admin'?[actor.organization_id,id]:[actor.organization_id,id,actor.id],client,
  );
  if(!rows.length) throw new HttpError(404,'Record not found');
  return rows[0];
}

export async function archiveRecord(actor:Actor,resource:string,id:string):Promise<void>{
  if(!supportsArchive(resource)) throw new HttpError(400,'Only company and candidate leads can be deleted');
  ensureAdmin(actor); if(!UUID.test(id)) throw new HttpError(404,'Record not found');
  const def=definition(resource);
  const result=await sql(`UPDATE ${def.table} SET deleted_at=now(),deleted_by=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL RETURNING id`,[actor.id,id,actor.organization_id]);
  if(!result.length) throw new HttpError(404,'Record not found');
  await audit(actor,'archive',def.table,id,{reason:'Admin deleted lead'});
}
export async function restoreRecord(actor:Actor,resource:string,id:string):Promise<void>{
  if(!supportsArchive(resource)) throw new HttpError(400,'Only company and candidate leads can be restored');
  ensureAdmin(actor); const def=definition(resource);
  const result=await sql(`UPDATE ${def.table} SET deleted_at=NULL,deleted_by=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NOT NULL RETURNING id`,[id,actor.organization_id]);
  if(!result.length) throw new HttpError(404,'Archived record not found'); await audit(actor,'restore',def.table,id,{});
}

function parseField(field:Field,value:unknown,allowed?:string[],previous?:unknown):unknown {
  if(field.type==='skills') {
    const skills=Array.isArray(value)?value:String(value || '').split(',');
    return skills.map(v=>String(v).trim()).filter(Boolean).slice(0,40);
  }
  if(value===null || value===undefined || value==='') {
    if(field.required) throw new HttpError(400,`${field.label} is required`);
    return null;
  }
  if(field.type==='number') {
    const number=Number(value);
    if(!Number.isFinite(number)||number<0||number>100000000) throw new HttpError(400,`${field.label} is invalid`);
    return number;
  }
  const text=String(value).trim();
  if(text.length>5000) throw new HttpError(400,`${field.label} is too long`);
  if(field.type==='email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new HttpError(400,'Invalid email address');
  if(field.type==='select' && field.options) {
    const permitted=allowed ?? field.options;
    if(!permitted.includes(text) && !(previous!==undefined && previous!==null && String(previous)===text)) throw new HttpError(400,`Invalid ${field.label}`);
  }
  if(['user','client','candidate','job','application'].includes(field.type) && !UUID.test(text)) throw new HttpError(400,`Invalid ${field.label}`);
  if(['date','datetime-local'].includes(field.type) && !Number.isFinite(new Date(text).valueOf())) throw new HttpError(400,`Invalid ${field.label}`);
  if(['email','tel','text'].includes(field.type) && field.type!=='textarea' && text.length>300) throw new HttpError(400,`${field.label} is too long`);
  return text;
}

async function verifyOwner(actor:Actor,id:string|null,client:PoolClient):Promise<void> {
  if(!id) return;
  const user=await one('SELECT id FROM users WHERE organization_id=$1 AND id=$2 AND active=true',
    [actor.organization_id,id],client);
  if(!user) throw new HttpError(400,'Assigned recruiter not found or disabled');
}

async function verifyLink(actor:Actor,table:string,id:string|null,client:PoolClient):Promise<void> {
  if(!id) return;
  if(!['clients','candidates','jobs','applications'].includes(table)) throw new HttpError(400,'Invalid linked record');
  const found=await one(
    `SELECT id FROM ${table} WHERE id=$1 AND organization_id=$2 ${actor.role==='admin'?'':'AND owner_id=$3'}`,
    actor.role==='admin'?[id,actor.organization_id]:[id,actor.organization_id,actor.id],client);
  if(!found) throw new HttpError(400,'Linked record not found or not assigned to you');
}

async function verifyRelated(actor:Actor,values:Row,client:PoolClient):Promise<void> {
  for(const [column,table] of Object.entries({client_id:'clients',candidate_id:'candidates',job_id:'jobs',application_id:'applications'})) {
    if(values[column]) await verifyLink(actor,table,String(values[column]),client);
  }
  if(values.target_id || values.target_type) {
    const type=String(values.target_type || '');
    if(!['company_leads','candidates','applications'].includes(type)) throw new HttpError(400,'Invalid follow-up record type');
    const recordId=String(values.target_id || '');
    if(!UUID.test(recordId)) throw new HttpError(400,'Invalid follow-up record');
    const found=await one(
      `SELECT id FROM ${type} WHERE id=$1 AND organization_id=$2 ${actor.role==='admin'?'':'AND owner_id=$3'}`,
      actor.role==='admin'?[recordId,actor.organization_id]:[recordId,actor.organization_id,actor.id],client,
    );
    if(!found) throw new HttpError(400,'Follow-up target is not assigned to you');
  }
}

function validated(resource:string,data:Row,create:boolean,allowed:Record<string,string[]>={},previous?:Row,customDefs?:CustomFieldDef[]):Row {
  const def=definition(resource);
  const out:Row={};
  for(const field of def.fields) {
    if(!(field.name in data)) {
      if(create && field.required) throw new HttpError(400,`${field.label} is required`);
      continue;
    }
    out[field.name]=parseField(field,data[field.name],allowed[field.name],previous?.[field.name]);
  }
  if(customDefs && ('custom' in data || (create && customDefs.some(d=>d.active&&d.required))))
    out.custom=JSON.stringify(validateCustomValues(customDefs,data.custom,(previous?.custom as Row|undefined) ?? {},create));
  if(resource==='candidates') {
    if('email' in out) out.normalized_email=normalizeEmail(out.email as string|null);
    if('phone' in out) out.normalized_phone=normalizePhone(out.phone as string|null);
  }
  if(resource==='company-leads' && out.email) out.email=normalizeEmail(out.email as string);
  return out;
}

async function checkCandidateDuplicates(actor:Actor,values:Row,client:PoolClient,id?:string) {
  if(!values.normalized_email && !values.normalized_phone) return;
  const matches=await sql<Row>(
    `SELECT id,owner_id,full_name FROM candidates WHERE organization_id=$1
     AND (($2::text IS NOT NULL AND normalized_email=$2) OR ($3::text IS NOT NULL AND normalized_phone=$3))
     AND ($4::uuid IS NULL OR id<>$4::uuid) LIMIT 1`,
    [actor.organization_id,values.normalized_email||null,values.normalized_phone||null,id||null],client,
  );
  if(matches.length) throw new HttpError(409,'Candidate with this email or phone may already exist. Request Admin review.');
}

export async function createRecord(actor:Actor,resource:string,data:Row):Promise<Row> {
  const def=definition(resource);
  const values=validated(resource,data,true,await optionValuesFor(actor.organization_id,resource),undefined,await customDefsFor(actor.organization_id,resource));
  if(actor.role!=='admin') values.owner_id=actor.id;
  else values.owner_id=values.owner_id || actor.id;
  return transaction(async client=>{
    await verifyOwner(actor,values.owner_id as string,client);
    await verifyRelated(actor,values,client);
    if(resource==='candidates') await checkCandidateDuplicates(actor,values,client);
    const fields=Object.keys(values);
    const insertFields=['organization_id','created_by',...fields];
    const placeholders=insertFields.map((_,index)=>`$${index+1}`).join(',');
    const args=[actor.organization_id,actor.id,...fields.map(field=>values[field])];
    const created=await one<Row>(
      `INSERT INTO ${def.table}(${insertFields.join(',')}) VALUES(${placeholders}) RETURNING *`,args,client);
    if(!created) throw new HttpError(500,'Unable to create record');
    const id=String(created.id);
    if(resource==='followups') {
      await notify(actor.organization_id,String(values.owner_id),'New follow-up assigned',
                   String(values.title),'/followups',client);
    } else {
      await sql('INSERT INTO assignment_history(organization_id,entity_type,entity_id,to_owner,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)',
        [actor.organization_id,def.table,id,values.owner_id,actor.id,'Record created'],client);
      if(created.stage) await sql(
        'INSERT INTO stage_history(organization_id,entity_type,entity_id,new_stage,changed_by) VALUES($1,$2,$3,$4,$5)',
        [actor.organization_id,def.table,id,created.stage,actor.id],client);
      if(actor.id!==values.owner_id) await notify(actor.organization_id,String(values.owner_id),
        `New ${def.singular} assigned`,String(created.company_name||created.full_name||created.title||''),
        `/${resource}`,client);
    }
    if(resource==='company-leads' && values.next_followup_at) {
      await sql(`INSERT INTO followups(organization_id,target_type,target_id,owner_id,due_at,title,created_by)
                 VALUES($1,'company_leads',$2,$3,$4,$5,$6)`,
        [actor.organization_id,id,values.owner_id,values.next_followup_at,
         `Contact ${values.company_name}`,actor.id],client);
    }
    await audit(actor,'create',def.table,id,{source:values.source || 'manual'},client);
    return created;
  });
}

export async function updateRecord(actor:Actor,resource:string,id:string,data:Row):Promise<Row> {
  const def=definition(resource);
  if(resource==='followups' && ('status' in data || 'owner_id' in data && actor.role!=='admin')) {
    if('status' in data) throw new HttpError(400,'Complete tasks via Log Follow-up');
  }
  const values=validated(resource,data,false,await optionValuesFor(actor.organization_id,resource),await getRecord(actor,resource,id),await customDefsFor(actor.organization_id,resource));
  if(actor.role!=='admin' && 'owner_id' in values) throw new HttpError(403,'Only Admin can reassign work');
  if(resource==='followups' && ('target_type' in values || 'target_id' in values)) throw new HttpError(400,'Cannot change follow-up target');
  if(!Object.keys(values).length) throw new HttpError(400,'No editable fields provided');
  return transaction(async client=>{
    const previous=await getRecord(actor,resource,id,client);
    if('owner_id' in values) await verifyOwner(actor,values.owner_id as string,client);
    await verifyRelated(actor,values,client);
    if(resource==='candidates' && ('normalized_email' in values || 'normalized_phone' in values)) {
      await checkCandidateDuplicates(actor,{
        normalized_email:values.normalized_email ?? previous.normalized_email,
        normalized_phone:values.normalized_phone ?? previous.normalized_phone,
      },client,id);
    }
    const fields=Object.keys(values);
    const args=[...fields.map(field=>values[field]),actor.organization_id,id];
    const setters=fields.map((field,index)=>`${field}=$${index+1}`);
    const result=await one<Row>(
      `UPDATE ${def.table} SET ${setters.join(',')}${resource!=='followups'?',updated_at=now()':''}
       WHERE organization_id=$${fields.length+1} AND id=$${fields.length+2} RETURNING *`,args,client);
    if(!result) throw new HttpError(404,'Record not found');
    if('stage' in values && values.stage!==previous.stage) {
      await sql('INSERT INTO stage_history(organization_id,entity_type,entity_id,old_stage,new_stage,changed_by) VALUES($1,$2,$3,$4,$5,$6)',
        [actor.organization_id,def.table,id,previous.stage||null,values.stage,actor.id],client);
    }
    if('owner_id' in values && values.owner_id!==previous.owner_id) {
      ensureAdmin(actor);
      await sql('INSERT INTO assignment_history(organization_id,entity_type,entity_id,from_owner,to_owner,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [actor.organization_id,def.table,id,previous.owner_id,values.owner_id,actor.id,'Admin reassignment'],client);
      if(['company_leads','candidates','applications'].includes(def.table)) await sql(
        `UPDATE followups SET owner_id=$1
         WHERE organization_id=$2 AND target_type=$3 AND target_id=$4
         AND status='pending' AND owner_id IS NOT DISTINCT FROM $5::uuid`,
        [values.owner_id,actor.organization_id,def.table,id,previous.owner_id],client);
      await notify(actor.organization_id,String(values.owner_id),`Reassigned ${def.singular}`,
        'An Admin assigned you a record',`/${resource}`,client);
    }
    await audit(actor,'update',def.table,id,{fields,previous_stage:previous.stage},client);
    return result;
  });
}
