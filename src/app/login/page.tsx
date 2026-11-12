import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

/** Real authenticated users must not see the sign-in screen again. */
export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(actor.must_change_password ? '/profile' : '/dashboard');
  return <LoginForm />;
}
