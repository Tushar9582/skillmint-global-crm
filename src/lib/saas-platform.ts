import { getActor, HttpError, isDevDemoMode, isDemoModeRequested, type Actor } from './auth';
import { one, sql, transaction } from './db';
import { isPlatformAdmin } from './saas';
import { platformEnabled, tenantScope } from './tenant-context';

export const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function requirePlatformOwner():Promise<Actor>{
  if(tenantScope()||!platformEnabled()||isDevDemoMode()||isDemoModeRequested())throw new HttpError(404,'Not found');
  const actor=await getActor();
  if(!actor||actor.must_change_password||!await isPlatformAdmin(actor))throw new HttpError(403,'Platform owner permission required');
  return actor;
}

export async function platformOverview(){
  const actor=await requirePlatformOwner();
  const companies=await sql(`SELECT o.id,coalesce(s.display_name,o.name) AS name,o.created_at,
    coalesce(a.status,'unconfigured') AS status,a.trial_ends_at,a.paid_until,
    CASE WHEN a.status='trial' AND a.trial_ends_at<=now() THEN 'expired'
      WHEN a.status='active' AND a.paid_until<=now() THEN 'expired'
      ELSE coalesce(a.status,'unconfigured') END AS effective_status,
    (SELECT count(*)::int FROM users u WHERE u.organization_id=o.id AND u.active) AS users,
    (SELECT count(*)::int FROM company_leads l WHERE l.organization_id=o.id) AS leads,
    (SELECT count(*)::int FROM candidates c WHERE c.organization_id=o.id) AS candidates
    FROM organizations o LEFT JOIN saas_workspace_access a ON a.organization_id=o.id
    LEFT JOIN saas_workspace_settings s ON s.organization_id=o.id
    WHERE o.id<>$1 AND a.status IS DISTINCT FROM 'platform'
    ORDER BY o.created_at DESC`,[actor.organization_id]);
  const audit=await sql(`SELECT p.id,p.action,p.created_at,p.details,o.name AS company
    FROM saas_platform_audit p LEFT JOIN organizations o ON o.id=p.workspace_id
    ORDER BY p.created_at DESC LIMIT 100`);
  return {companies,audit};
}
export async function platformCompany(id:string){
  const actor=await requirePlatformOwner();
  if(!UUID_PATTERN.test(id)||id===actor.organization_id)throw new HttpError(404,'Company not found');
  return transaction(async client=>{
    const company=await one(`SELECT o.id,coalesce(s.display_name,o.name) name,s.website,s.contact_email,a.status,a.trial_ends_at,a.paid_until
      FROM organizations o LEFT JOIN saas_workspace_settings s ON s.organization_id=o.id
      LEFT JOIN saas_workspace_access a ON a.organization_id=o.id WHERE o.id=$1 AND a.status IS DISTINCT FROM 'platform'`,[id],client);
    if(!company)throw new HttpError(404,'Company not found');
    const users=await sql(`SELECT id,full_name,email,role,active,created_at FROM users WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 250`,[id],client);
    const counts=await one(`SELECT (SELECT count(*)::int FROM company_leads WHERE organization_id=$1) leads,
      (SELECT count(*)::int FROM candidates WHERE organization_id=$1) candidates,
      (SELECT count(*)::int FROM applications WHERE organization_id=$1) applications,
      (SELECT count(*)::int FROM interviews WHERE organization_id=$1) interviews,
      (SELECT count(*)::int FROM followups WHERE organization_id=$1) followups,
      (SELECT count(*)::int FROM resume_builder_drafts WHERE organization_id=$1) drafts`,[id],client);
    await sql("INSERT INTO saas_platform_audit(actor_id,workspace_id,action) VALUES($1,$2,'workspace_view')",[actor.id,id],client);
    return {company,users,counts};
  });
}
export async function changeWorkspaceAccess(id:string,input:Record<string,unknown>){
  const actor=await requirePlatformOwner();
  if(!UUID_PATTERN.test(id)||id===actor.organization_id)throw new HttpError(404,'Company not found');
  const action=input.action,reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<8||reason.length>500)throw new HttpError(400,'Enter a reason (8–500 characters).');
  if(action!=='activate'&&action!=='suspend'&&action!=='trial')throw new HttpError(400,'Invalid subscription action.');
  const paidUntil=typeof input.paidUntil==='string'?new Date(input.paidUntil):null;
  if(action==='activate'&&(!paidUntil||!Number.isFinite(paidUntil.getTime())||paidUntil<=new Date()))throw new HttpError(400,'Enter a future expiry date.');
  await transaction(async client=>{
    const previous=await one<{status:string}>("SELECT status FROM saas_workspace_access WHERE organization_id=$1 AND status<>'platform' FOR UPDATE",[id],client);
    if(!previous)throw new HttpError(404,'Company not found');
    if(action==='activate')await sql("UPDATE saas_workspace_access SET status='active',paid_until=$2 WHERE organization_id=$1",[id,paidUntil!.toISOString()],client);
    else if(action==='suspend')await sql("UPDATE saas_workspace_access SET status='suspended' WHERE organization_id=$1",[id],client);
    else await sql("UPDATE saas_workspace_access SET status='trial',trial_ends_at=now()+interval '3 days',paid_until=NULL WHERE organization_id=$1",[id],client);
    await sql("INSERT INTO saas_platform_audit(actor_id,workspace_id,action,details) VALUES($1,$2,$3,$4::jsonb)",[actor.id,id,'access_'+action,JSON.stringify({reason,previous:previous.status,paidUntil:action==='activate'?paidUntil!.toISOString():null})],client);
  });
}
