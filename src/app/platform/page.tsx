import {redirect,notFound} from 'next/navigation';
import {getActor} from '@/lib/auth';
import {isPlatformAdmin} from '@/lib/saas';
import {platformEnabled} from '@/lib/tenant-context';
import {PlatformConsole} from '@/components/platform-console';
export const dynamic='force-dynamic';
export default async function PlatformPage(){
 if(!platformEnabled())notFound();
 const actor=await getActor();
 if(!actor)redirect('/login');
 if(!await isPlatformAdmin(actor)||actor.must_change_password)redirect('/dashboard');
 return <PlatformConsole ownerName={actor.full_name}/>;
}
