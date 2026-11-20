import { getActor,isDemoModeRequested,isDevDemoMode } from '@/lib/auth';
import {companyProfile} from '@/lib/company-profile';
import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace-shell';

export default async function WorkspaceLayout({children}:{children:React.ReactNode}) {
  const user=await getActor();
  if(!user) redirect('/login');
  const p=(!isDemoModeRequested()&&!isDevDemoMode())?await companyProfile(user.organization_id):null;
  const branding=p?{name:p.display_name,logoUrl:p.has_logo?'/api/v1/company-profile/logo?v='+encodeURIComponent(p.updated_at||''):null}:undefined;
  return <WorkspaceShell isolatedDemo={isDemoModeRequested()} developmentDemo={isDevDemoMode()} branding={branding} user={{id:user.id,full_name:user.full_name,email:user.email,
    role:user.role,must_change_password:user.must_change_password}}>{children}</WorkspaceShell>;
}
