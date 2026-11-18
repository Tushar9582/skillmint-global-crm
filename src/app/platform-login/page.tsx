import {redirect} from 'next/navigation';
import {currentOwner} from '@/lib/platform-auth';
import {OwnerLogin} from './owner-login';
export const dynamic='force-dynamic';
export default async function PlatformLogin(){if(await currentOwner())redirect('/platform');return <OwnerLogin/>;}
