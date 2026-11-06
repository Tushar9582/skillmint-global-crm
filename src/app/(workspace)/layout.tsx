import { getActor } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace-shell';

export default async function WorkspaceLayout({children}:{children:React.ReactNode}) {
  const user=await getActor();
  if(!user) redirect('/login');
  return <WorkspaceShell user={{id:user.id,full_name:user.full_name,email:user.email,
    role:user.role,must_change_password:user.must_change_password}}>{children}</WorkspaceShell>;
}
