
import {api} from '@/lib/http';
import {one} from '@/lib/db';
export const GET=api(async(_request,actor)=>{
 const row=await one<{logo_base64:string|null}>('SELECT logo_base64 FROM hrdiary_company_profiles WHERE organization_id=$1',[actor.organization_id]);
 if(!row?.logo_base64)return new Response(null,{status:404,headers:{'Cache-Control':'private, no-store'}});
 return new Response(new Uint8Array(Buffer.from(row.logo_base64,'base64')),{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"}});
});
