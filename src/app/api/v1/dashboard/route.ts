import { api, json } from '@/lib/http';
import { sql, one } from '@/lib/db';

export const GET=api(async(_request,actor)=>{
  const params=actor.role==='admin'?[actor.organization_id]:[actor.organization_id,actor.id];
  const scope=actor.role==='admin'?'':'AND owner_id=$2';
  const count=async(table:string,condition='')=>{
    const result=await one<{count:string}>(
      `SELECT count(*)::text AS count FROM ${table} WHERE organization_id=$1 ${scope} ${condition}`,params);
    return Number(result?.count||0);
  };
  const [company_leads,candidates,jobs,applications,interviews_today,followups_due,overdue,placements]=await Promise.all([
    count('company_leads'),count('candidates'),count('jobs',"AND stage NOT IN ('closed','filled','cancelled')"),
    count('applications'),count('interviews',"AND scheduled_at::date=(now() AT TIME ZONE 'Asia/Kolkata')::date"),
    count('followups',"AND status='pending' AND due_at::date=(now() AT TIME ZONE 'Asia/Kolkata')::date"),
    count('followups',"AND status='pending' AND due_at<now()"),count('applications',"AND stage='joined'"),
  ]);
  const pending=await sql(
    `SELECT f.id,f.title,f.due_at,f.target_type,f.target_id,f.priority,
      u.full_name AS owner_name FROM followups f LEFT JOIN users u ON u.id=f.owner_id
     WHERE f.organization_id=$1 ${actor.role==='admin'?'':'AND f.owner_id=$2'}
       AND f.status='pending' ORDER BY f.due_at ASC LIMIT 10`,params);
  const latest=actor.role==='admin'
    ? await sql(`SELECT a.id,a.action,a.entity_type,a.created_at,u.full_name AS actor_name
                 FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.organization_id=$1
                 ORDER BY a.created_at DESC LIMIT 8`,[actor.organization_id])
    : await sql(`SELECT a.id,a.channel,a.outcome,a.created_at FROM activities a
                 WHERE a.organization_id=$1 AND a.actor_id=$2 ORDER BY a.created_at DESC LIMIT 8`,params);
  const exceptions=actor.role==='admin' ? {
    unassigned_leads:await count('company_leads','AND owner_id IS NULL'),
    duplicate_reviews:Number((await one<{count:string}>(
      `SELECT count(*)::text AS count FROM duplicate_reviews WHERE organization_id=$1 AND status='pending'`,
      [actor.organization_id]))?.count||0),
  } : null;
  return json({data:{company_leads,candidates,jobs,applications,interviews_today,followups_due,
    overdue,placements,queue:pending,latest,exceptions,role:actor.role}});
});
