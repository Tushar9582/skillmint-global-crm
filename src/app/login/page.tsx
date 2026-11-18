import { redirect } from 'next/navigation';
import { getActor, isDemoModeRequested, isDevDemoMode } from '@/lib/auth';
import {currentOwner} from '@/lib/platform-auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/** Real authenticated users must not see the sign-in screen again. */
export default async function LoginPage() {
  if(!isDemoModeRequested()&&!isDevDemoMode()&&await currentOwner())redirect('/platform');
  const actor = await getActor();
  if (actor) redirect(actor.must_change_password ? '/profile' : '/dashboard');
  return <LoginForm />;
}
