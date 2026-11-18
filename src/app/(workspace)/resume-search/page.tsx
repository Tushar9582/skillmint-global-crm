import {getActor,isDemoModeRequested,isDevDemoMode} from '@/lib/auth';
import {redirect} from 'next/navigation';
import {ResumeSearch} from '@/components/resume-search';
export default async function Page(){const actor=await getActor();if(!actor)redirect('/login');if(isDemoModeRequested()||isDevDemoMode())redirect('/candidates');if(actor.must_change_password)redirect('/profile');return <ResumeSearch admin={actor.role==='admin'}/>;}
