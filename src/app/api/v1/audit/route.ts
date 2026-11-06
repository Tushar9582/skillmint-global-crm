import { api, json } from '@/lib/http';
import { ensureAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';

export const GET=api(async(_request,actor)=>{
  ensureAdmin(actor);
  return json({data:await sql(
    `SELECT a.id,a.action,a.entity_type,a.entity_id,a.details,a.created_at,
      u.full_name AS actor_name FROM audit_events a
     LEFT JOIN users u ON u.id=a.actor_id WHERE a.organization_id=$1
     ORDER BY a.created_at DESC LIMIT 250`,[actor.organization_id])});
});
