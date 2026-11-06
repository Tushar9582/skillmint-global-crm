import { api, body, json } from '@/lib/http';
import { one, sql } from '@/lib/db';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';

async function getStats(org:string,user:string,day:string) {
  const result=await one<{activities:number;followups:number;calls:number;interviews:number}>(
    `SELECT
      (SELECT count(*)::int FROM activities WHERE organization_id=$1 AND actor_id=$2 AND (created_at AT TIME ZONE 'Asia/Kolkata')::date=$3::date) AS activities,
      (SELECT count(*)::int FROM followups WHERE organization_id=$1 AND completed_by=$2 AND (completed_at AT TIME ZONE 'Asia/Kolkata')::date=$3::date) AS followups,
      (SELECT count(*)::int FROM activities WHERE organization_id=$1 AND actor_id=$2 AND channel='call' AND (created_at AT TIME ZONE 'Asia/Kolkata')::date=$3::date) AS calls,
      (SELECT count(*)::int FROM interviews WHERE organization_id=$1 AND owner_id=$2 AND (scheduled_at AT TIME ZONE 'Asia/Kolkata')::date=$3::date) AS interviews`,
    [org,user,day]);
  return result ?? {activities:0,followups:0,calls:0,interviews:0};
}

export const GET=api(async(request,actor)=>{
  const day=request.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0,10);
  const userId=actor.role==='admin' && request.nextUrl.searchParams.get('employee_id') || actor.id;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400,'Invalid date');
  if(actor.role==='admin'&&userId!==actor.id) {
    const target=await one('SELECT id FROM users WHERE id=$1 AND organization_id=$2',[userId,actor.organization_id]);
    if(!target) throw new HttpError(404,'Employee not found');
  }
  const report=await one('SELECT * FROM daily_reports WHERE organization_id=$1 AND user_id=$2 AND report_date=$3',
    [actor.organization_id,userId,day]);
  return json({data:{date:day,stats:await getStats(actor.organization_id,userId,day),report}});
});

export const POST=api(async(request,actor)=>{
  const input=await body(request);
  const day=String(input.date||new Date().toISOString().slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400,'Invalid report date');
  const blockers=String(input.blockers||'').slice(0,5000);
  const tomorrow=String(input.tomorrow_plan||'').slice(0,5000);
  const rows=await sql(
    `INSERT INTO daily_reports(organization_id,user_id,report_date,blockers,tomorrow_plan)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(user_id,report_date) DO UPDATE SET blockers=EXCLUDED.blockers,
       tomorrow_plan=EXCLUDED.tomorrow_plan,submitted_at=now() RETURNING *`,
    [actor.organization_id,actor.id,day,blockers,tomorrow]);
  await audit(actor,'daily_report_submit','daily_reports',String(rows[0].id),{date:day});
  return json({data:{report:rows[0],stats:await getStats(actor.organization_id,actor.id,day)}});
});
