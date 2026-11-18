import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifiedIdentity} from '@/lib/company-auth';
import {GoogleCompanyForm} from './setup-form';
export const dynamic='force-dynamic';
export default async function GoogleSetup(){
 const token=(await cookies()).get('hd_google_setup')?.value;
 const identity=await verifiedIdentity(token);
 if(!identity)redirect('/login?google=failed');
 return <GoogleCompanyForm email={identity.email||''}/>;
}
