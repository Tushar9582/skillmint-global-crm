import {redirect,notFound} from 'next/navigation';
import {getActor,isDemoModeRequested,isDevDemoMode} from '@/lib/auth';
import {workspaceAccess,isPlatformAdmin} from '@/lib/saas';
import {saasIsolationEnabled,withTenantScope} from '@/lib/tenant-context';
import {one} from '@/lib/db';
import {SubscriptionScreen} from '@/components/subscription-screen';
export const dynamic='force-dynamic';
export default async function WorkspaceAccess(){
 if(!saasIsolationEnabled()||isDemoModeRequested()||isDevDemoMode())notFound();
 const actor=await getActor();if(!actor)redirect('/login');
 if(await isPlatformAdmin(actor))redirect('/platform');
 const data=await withTenantScope({organizationId:actor.organization_id,userId:actor.id},async()=>{
  const access=await workspaceAccess(actor.organization_id);
  const company=await one<{name:string}>('SELECT name FROM organizations WHERE id=$1',[actor.organization_id]);
  return {access,company:company?.name||'Your workspace'};
 });
 return <SubscriptionScreen company={data.company} status={data.access?.status||'unconfigured'} allowed={Boolean(data.access?.allowed)} trialEnds={data.access?.trial_ends_at||null} paidUntil={data.access?.paid_until||null} admin={actor.role==='admin'}/>;
}
