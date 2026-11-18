import { redirect,notFound } from 'next/navigation';
import { getActor } from '@/lib/auth';
import { registrationEnabled } from '@/lib/tenant-context';
import { RegisterForm } from './register-form';
export const dynamic='force-dynamic';
export default async function RegisterPage(){
  if(!registrationEnabled()||!process.env.RESEND_API_KEY||!process.env.SAAS_FROM_EMAIL)notFound();
  if(await getActor())redirect('/dashboard');
  return <RegisterForm/>;
}
