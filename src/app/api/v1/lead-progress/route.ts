import { api, json } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { sql } from '@/lib/db';
import { emptyRecruiterProgress, parseProgressPeriod, type RecruiterProgress } from '@/lib/lead-operations';

type Aggregate={user_id:string|null;amount:number;calls?:number;meetings?:number;latest?:string|null};

/** Admin-only recruiter workload and actual recorded work in a selected date range. */
export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
  let period:ReturnType<typeof parseProgressPeriod>;
  try{period=parseProgressPeriod(request.nextUrl.searchParams.get('from')||today,request.nextUrl.searchParams.get('to')||today);}
  catch(error){throw new HttpError(400,(error as Error).message);}
  const org=[actor.organization_id];
  const dated=[actor.organization_id,period.startIso,period.endExclusiveIso];
  const [users,companies,candidates,applications,activities,stages,completed,interviews,pending]=await Promise.all([
    sql<{id:string;full_name:string;team:string|null;active:boolean}>(
      `SELECT id,full_name,team,active FROM users WHERE organization_id=$1 ORDER BY active DESC,full_name`,org),
    sql<Aggregate>(`SELECT owner_id AS user_id,count(*)::integer AS amount FROM company_leads
      WHERE organization_id=$1 AND deleted_at IS NULL GROUP BY owner_id`,org),
    sql<Aggregate>(`SELECT owner_id AS user_id,count(*)::integer AS amount FROM candidates
      WHERE organization_id=$1 AND deleted_at IS NULL GROUP BY owner_id`,org),
    sql<Aggregate>(`SELECT owner_id AS user_id,count(*)::integer AS amount FROM applications
      WHERE organization_id=$1 GROUP BY owner_id`,org),
    sql<Aggregate>(`SELECT actor_id AS user_id,count(*)::integer AS amount,
      count(*) FILTER (WHERE channel='call')::integer AS calls,
      count(*) FILTER (WHERE channel='meeting')::integer AS meetings,
      max(created_at) AS latest FROM activities
      WHERE organization_id=$1 AND created_at >= $2 AND created_at < $3 GROUP BY actor_id`,dated),
    sql<Aggregate>(`SELECT changed_by AS user_id,count(*)::integer AS amount FROM stage_history
      WHERE organization_id=$1 AND entity_type IN ('company_leads','candidates','applications')
        AND created_at >= $2 AND created_at < $3 GROUP BY changed_by`,dated),
    sql<Aggregate>(`SELECT completed_by AS user_id,count(*)::integer AS amount FROM followups
      WHERE organization_id=$1 AND status='done' AND completed_at >= $2 AND completed_at < $3 GROUP BY completed_by`,dated),
    sql<Aggregate>(`SELECT owner_id AS user_id,count(*)::integer AS amount FROM interviews
      WHERE organization_id=$1 AND scheduled_at >= $2 AND scheduled_at < $3 GROUP BY owner_id`,dated),
    sql<Aggregate>(`SELECT owner_id AS user_id,count(*)::integer AS amount FROM followups
      WHERE organization_id=$1 AND status='pending' GROUP BY owner_id`,org),
  ]);
  const byId=new Map<string,RecruiterProgress>(users.map(person=>[person.id,emptyRecruiterProgress(person)]));
  const apply=(rows:Aggregate[],key:'company_leads'|'candidates'|'applications'|'activities'|'stage_updates'|'followups_done'|'interviews_scheduled'|'pending_followups')=>{
    for(const row of rows){const person=row.user_id&&byId.get(row.user_id);if(!person)continue;
      person[key]=Number(row.amount||0);
      if(key==='activities'){
        person.calls=Number(row.calls||0);person.meetings=Number(row.meetings||0);
        person.last_activity_at=row.latest||null;
      }
    }
  };
  apply(companies,'company_leads');apply(candidates,'candidates');apply(applications,'applications');
  apply(activities,'activities');apply(stages,'stage_updates');apply(completed,'followups_done');
  apply(interviews,'interviews_scheduled');apply(pending,'pending_followups');
  const employees=[...byId.values()].sort((a,b)=>Number(b.active)-Number(a.active)||
    b.company_leads+b.candidates+b.applications-(a.company_leads+a.candidates+a.applications)||
    a.full_name.localeCompare(b.full_name));
  const summary=employees.reduce((total,person)=>({
    assigned:total.assigned+person.company_leads+person.candidates+person.applications,
    activities:total.activities+person.activities,
    meetings:total.meetings+person.meetings+person.interviews_scheduled,
    followups:total.followups+person.followups_done,
  }),{assigned:0,activities:0,meetings:0,followups:0});
  return json({data:{period:{from:period.from,to:period.to},summary,employees}});
});
