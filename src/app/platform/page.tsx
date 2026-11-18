import {redirect} from 'next/navigation';
import {currentOwner} from '@/lib/platform-auth';
import {PlatformConsole} from '@/components/hrdiary-platform-preview';
import '../saas-preview/preview.css';
export const dynamic='force-dynamic';
export default async function PlatformPage(){const owner=await currentOwner();if(!owner)redirect('/platform-login');return <PlatformConsole ownerName={owner.email}/>;}
