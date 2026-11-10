import { api, json } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { getRecord, UUID } from '@/lib/records';
import { isLeadResource } from '@/lib/lead-operations';
import { CATALOG } from '@/lib/catalog';
import { sql } from '@/lib/db';

/** A complete read-only lead timeline, scoped by the caller's record permissions. */
export const GET=api(async(request,actor)=>{
  const resource=request.nextUrl.searchParams.get('resource')||'';
  const id=request.nextUrl.searchParams.get('id')||'';
  if(!isLeadResource(resource)||!UUID.test(id))throw new HttpError(400,'Choose a valid lead');
  await getRecord(actor,resource,id);
  const entity=CATALOG[resource].table;
  const params=[actor.organization_id,id];
  const [stages,assignments,followups,interviews]=await Promise.all([
    sql(`SELECT s.id,s.old_stage,s.new_stage,s.created_at,u.full_name AS changed_by_name
         FROM stage_history s LEFT JOIN users u ON u.id=s.changed_by AND u.organization_id=s.organization_id
         WHERE s.organization_id=$1 AND s.entity_type=$3 AND s.entity_id=$2
         ORDER BY s.created_at DESC LIMIT 30`,[...params,entity]),
    sql(`SELECT h.id,h.reason,h.created_at,prior.full_name AS from_name,next.full_name AS to_name
         FROM assignment_history h LEFT JOIN users prior ON prior.id=h.from_owner AND prior.organization_id=h.organization_id
         LEFT JOIN users next ON next.id=h.to_owner AND next.organization_id=h.organization_id
         WHERE h.organization_id=$1 AND h.entity_type=$3 AND h.entity_id=$2
         ORDER BY h.created_at DESC LIMIT 30`,[...params,entity]),
    sql(`SELECT f.id,f.title,f.channel,f.status,f.due_at,f.completed_at,f.outcome,f.priority,
                u.full_name AS owner_name
         FROM followups f LEFT JOIN users u ON u.id=f.owner_id AND u.organization_id=f.organization_id
         WHERE f.organization_id=$1 AND f.target_type=$3 AND f.target_id=$2
         ORDER BY CASE WHEN f.status='pending' THEN 0 ELSE 1 END,
                  CASE WHEN f.status='pending' THEN f.due_at END ASC,f.due_at DESC LIMIT 30`,[...params,entity]),
    resource==='company-leads'?Promise.resolve([]):sql(
      `SELECT i.id,i.round_label,i.scheduled_at,i.mode,i.outcome,i.meeting_link,i.location,
              u.full_name AS owner_name FROM interviews i
       JOIN applications a ON a.id=i.application_id AND a.organization_id=i.organization_id
       LEFT JOIN users u ON u.id=i.owner_id AND u.organization_id=i.organization_id
       WHERE i.organization_id=$1 AND ${resource==='applications'?'a.id=$2':'a.candidate_id=$2'}
       ORDER BY i.scheduled_at DESC LIMIT 30`,params),
  ]);
  return json({data:{stages,assignments,followups,interviews}});
});
