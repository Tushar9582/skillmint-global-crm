import {NextRequest} from 'next/server';
import {currentOwner} from '@/lib/platform-auth';
import {one,sql} from '@/lib/db';
import {json} from '@/lib/http';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
 try{
  if(!await currentOwner())return json({error:'Super Admin authentication required'},403);
  const id=request.nextUrl.searchParams.get('company');
  if(id){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return json({error:'Invalid company'},400);
   const company=await one("SELECT id,name,'legacy' AS status,NULL AS trial_ends_at,NULL AS paid_until,NULL AS website,NULL AS contact_email FROM organizations WHERE id=$1",[id]);
   if(!company)return json({error:'Company not found'},404);
   const users=await sql('SELECT id,full_name,email,role,active FROM users WHERE organization_id=$1 ORDER BY created_at DESC',[id]);
   const counts=await one(`SELECT (SELECT count(*)::int FROM company_leads WHERE organization_id=$1) leads,(SELECT count(*)::int FROM candidates WHERE organization_id=$1) candidates,(SELECT count(*)::int FROM applications WHERE organization_id=$1) applications,(SELECT count(*)::int FROM interviews WHERE organization_id=$1) interviews,(SELECT count(*)::int FROM followups WHERE organization_id=$1) followups,(SELECT count(*)::int FROM resume_builder_drafts WHERE organization_id=$1) drafts`,[id]);
   return json({company,users,counts});
  }
  const companies=await sql(`SELECT o.id,o.name,o.created_at,'legacy' AS status,'legacy' AS effective_status,NULL AS trial_ends_at,NULL AS paid_until,(SELECT count(*)::int FROM users u WHERE u.organization_id=o.id AND u.active) users,(SELECT count(*)::int FROM company_leads l WHERE l.organization_id=o.id) leads,(SELECT count(*)::int FROM candidates c WHERE c.organization_id=o.id) candidates FROM organizations o ORDER BY o.created_at DESC`);
  const audit=await sql('SELECT a.id,a.action,a.created_at,a.details,o.name company FROM hrdiary_platform_audit a LEFT JOIN organizations o ON o.id=a.workspace_id ORDER BY a.created_at DESC LIMIT 100');
  return json({companies,audit});
 }catch{return json({error:'Unable to load platform data'},500);}
}
