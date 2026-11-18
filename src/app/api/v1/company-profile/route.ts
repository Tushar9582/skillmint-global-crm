
import {api,body,json} from '@/lib/http';
import {ensureAdmin,HttpError} from '@/lib/auth';
import {transaction,sql} from '@/lib/db';
import {audit} from '@/lib/audit';
import {companyProfile} from '@/lib/company-profile';
const limits={display_name:150,legal_name:200,industry:120,website:300,contact_email:254,phone:40,address:500,city:100,state:100,postal_code:30,country:100,tax_id:80,registration_number:100,description:1500} as const;
export const GET=api(async(_r,actor)=>json({data:await companyProfile(actor.organization_id)}));
export const PUT=api(async(request,actor)=>{
 ensureAdmin(actor);
 if(Number(request.headers.get('content-length')||0)>400000)throw new HttpError(413,'Logo or profile is too large.');
 const d=await body(request);
 const fields=Object.keys(limits) as (keyof typeof limits)[];
 const values=fields.map(k=>{const v=d[k];if(typeof v!=='string'||v.trim().length>limits[k])throw new HttpError(400,'Invalid '+k.replaceAll('_',' '));return v.trim();});
 if(!values[0])throw new HttpError(400,'Company name is required.');
 const website=values[fields.indexOf('website')];if(website){try{const u=new URL(website);if(!['https:','http:'].includes(u.protocol)||!u.hostname)throw Error();}catch{throw new HttpError(400,'Enter a website beginning with https://');}}
 const email=values[fields.indexOf('contact_email')];if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid contact email.');
 let logo:string|null|undefined=undefined;
 if(d.logo===null)logo=null;
 else if(d.logo!==undefined){
  if(typeof d.logo!=='string'||d.logo.length>350000||!/^[A-Za-z0-9+/]+={0,2}$/.test(d.logo))throw new HttpError(400,'Invalid PNG logo.');
  const bytes=Buffer.from(d.logo,'base64');
  if(bytes.length<33||bytes.length>256000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.subarray(12,16).toString()!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw new HttpError(400,'Logo must be PNG, up to 512×512 and 250 KB.');
  logo=bytes.toString('base64');
 }
 await transaction(async client=>{
  await client.query("SELECT set_config('hrdiary.profile_actor_id',$1,true)",[actor.id]);
  const cols=['organization_id',...fields,'logo_base64'];
  const args=[actor.organization_id,...values,logo??null];
  const updates=fields.map(k=>k+'=EXCLUDED.'+k);
  if(logo!==undefined)updates.push('logo_base64=EXCLUDED.logo_base64');
  await sql(`INSERT INTO hrdiary_company_profiles(${cols.join(',')}) VALUES(${args.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(organization_id) DO UPDATE SET ${updates.join(',')},updated_at=now()`,args,client);
  await audit(actor,'company_profile_update','organizations',actor.organization_id,{logo_changed:logo!==undefined},client);
 });
 return json({data:await companyProfile(actor.organization_id),message:'Company settings saved.'});
});
