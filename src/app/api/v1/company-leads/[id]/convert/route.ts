import { api, json } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { getRecord } from '@/lib/records';
import { one, sql, transaction } from '@/lib/db';

export const POST=api(async(request,actor)=>{
  const id=request.nextUrl.pathname.split('/')[4];
  const result=await transaction(async client=>{
    const lead=await getRecord(actor,'company-leads',id,client);
    const existing=await one<{id:string}>('SELECT id FROM clients WHERE company_lead_id=$1 AND organization_id=$2',
      [id,actor.organization_id],client);
    if(existing) throw new HttpError(409,'This lead was already converted');
    const clientAccount=await one<{id:string}>(
      `INSERT INTO clients(organization_id,company_lead_id,company_name,industry,city,
        contact_name,contact_email,contact_phone,owner_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [actor.organization_id,id,lead.company_name,lead.industry,lead.city,lead.contact_name,
       lead.email,lead.phone,lead.owner_id,actor.id],client);
    await sql('UPDATE company_leads SET stage=$1,updated_at=now() WHERE id=$2',["converted",id],client);
    await sql(`INSERT INTO stage_history(organization_id,entity_type,entity_id,old_stage,new_stage,changed_by)
               VALUES($1,'company_leads',$2,$3,'converted',$4)`,[actor.organization_id,id,lead.stage,actor.id],client);
    await audit(actor,'lead_converted','company_leads',id,{client_id:clientAccount?.id},client);
    return {client_id:clientAccount?.id,lead_id:id};
  });
  return json({data:result});
});
