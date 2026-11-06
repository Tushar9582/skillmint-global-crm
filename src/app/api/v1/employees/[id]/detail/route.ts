import { api, json } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { one, sql } from '@/lib/db';
import { UUID } from '@/lib/records';

export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const id=request.nextUrl.pathname.split('/')[4];
  if(!UUID.test(id)) throw new HttpError(400,'Invalid employee');
  const from=request.nextUrl.searchParams.get('from')||'2000-01-01';
  const to=request.nextUrl.searchParams.get('to')||'2099-12-31';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new HttpError(400,'Invalid date range');
  const user=await one(
    `SELECT id,full_name,email,role,team,active,created_at FROM users WHERE id=$1 AND organization_id=$2`,
    [id,actor.organization_id]);
  if(!user) throw new HttpError(404,'Employee not found');
  const [activity,followups,applications,daily,logins,history]=await Promise.all([
    sql(`SELECT channel,outcome,notes,target_type,target_id,created_at FROM activities
         WHERE organization_id=$1 AND actor_id=$2 AND created_at::date BETWEEN $3 AND $4
         ORDER BY created_at DESC LIMIT 150`,[actor.organization_id,id,from,to]),
    sql(`SELECT title,status,due_at,completed_at FROM followups WHERE organization_id=$1
         AND (owner_id=$2 OR completed_by=$2) AND created_at::date BETWEEN $3 AND $4
         ORDER BY created_at DESC LIMIT 100`,[actor.organization_id,id,from,to]),
    sql(`SELECT stage,count(*)::int AS total FROM applications WHERE organization_id=$1 AND owner_id=$2 GROUP BY stage`,
      [actor.organization_id,id]),
    sql(`SELECT report_date,blockers,tomorrow_plan,submitted_at FROM daily_reports
         WHERE organization_id=$1 AND user_id=$2 AND report_date BETWEEN $3 AND $4
         ORDER BY report_date DESC LIMIT 100`,[actor.organization_id,id,from,to]),
    sql(`SELECT success,created_at FROM login_history WHERE user_id=$1 AND created_at::date BETWEEN $2 AND $3
         ORDER BY created_at DESC LIMIT 40`,[id,from,to]),
    sql(`SELECT entity_type,from_owner,to_owner,created_at,reason FROM assignment_history
         WHERE organization_id=$1 AND (from_owner=$2 OR to_owner=$2) ORDER BY created_at DESC LIMIT 50`,
        [actor.organization_id,id]),
  ]);
  return json({data:{user,activity,followups,applications,daily,logins,history}});
});
