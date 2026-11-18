
import {getActor,isDemoModeRequested,isDevDemoMode} from '@/lib/auth';
import {redirect} from 'next/navigation';
import {CompanySettings} from '@/components/company-settings';
import {companyProfile} from '@/lib/company-profile';
export const dynamic='force-dynamic';
export default async function SettingsPage(){
 const actor=await getActor();if(!actor)redirect('/login');
 if(actor.role!=='admin'||isDemoModeRequested()||isDevDemoMode())redirect('/dashboard');
 if(actor.must_change_password)redirect('/profile');
 const profile=await companyProfile(actor.organization_id);if(!profile)redirect('/dashboard');
 return <CompanySettings initial={profile}/>;
}
