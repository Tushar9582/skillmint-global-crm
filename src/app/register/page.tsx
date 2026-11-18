import {redirect} from 'next/navigation';
import {getActor} from '@/lib/auth';
import {registrationIntakeEnabled} from '@/lib/company-auth';
import {RegisterForm} from './register-form';
export const dynamic='force-dynamic';
export default async function Register(){if(await getActor())redirect('/dashboard');return <RegisterForm enabled={registrationIntakeEnabled()}/>;}
