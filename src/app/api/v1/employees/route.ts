import { api, body, json } from '@/lib/http';
import { ensureAdmin, hashPassword, HttpError, normalizeEmail } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { sql, transaction } from '@/lib/db';

export const GET=api(async(_request,actor)=>{
  ensureAdmin(actor);
  const data=await sql(
    `SELECT u.id,u.full_name,u.email,u.role,u.team,u.active,u.created_at,
      (SELECT count(*)::integer FROM company_leads l WHERE l.owner_id=u.id) AS company_leads,
      (SELECT count(*)::integer FROM candidates c WHERE c.owner_id=u.id) AS candidates,
      (SELECT count(*)::integer FROM followups f WHERE f.owner_id=u.id AND f.status='pending') AS pending_followups
     FROM users u WHERE u.organization_id=$1 ORDER BY u.created_at DESC`,[actor.organization_id]);
  return json({data});
});

export const POST=api(async(request,actor)=>{
  ensureAdmin(actor);
  const data=await body(request);
  const name=String(data.full_name||'').trim();
  const email=normalizeEmail(String(data.email||''));
  const password=String(data.temporary_password||'');
  const team=String(data.team||'').trim();
  if(!name || name.length>150 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400,'Valid name and work email required');
  if(password.length<12 || password.length>128) throw new HttpError(400,'Temporary password must have at least 12 characters');
  const created=await transaction(async client=>{
    const result=await sql<{id:string;email:string;full_name:string}>(
      `INSERT INTO users(organization_id,full_name,email,password_hash,role,team,must_change_password)
       VALUES($1,$2,$3,$4,'employee',$5,true) RETURNING id,email,full_name`,
      [actor.organization_id,name,email,await hashPassword(password),team||null],client);
    await audit(actor,'employee_register','users',result[0].id,{email,team},client);
    return result[0];
  });
  return json({data:created,message:'Employee created. Share their temporary password privately.'},201);
});
