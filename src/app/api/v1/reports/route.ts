import { api, json } from '@/lib/http';
import { ensureAdmin } from '@/lib/auth';
import { sql, one } from '@/lib/db';

export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const start=request.nextUrl.searchParams.get('from')||'';
  const end=request.nextUrl.searchParams.get('to')||'';
  const since=/^\d{4}-\d{2}-\d{2}$/.test(start)?start:'2000-01-01';
  const until=/^\d{4}-\d{2}-\d{2}$/.test(end)?end:'2099-12-31';
  const [company,candidates,applications,employees]=await Promise.all([
    sql('SELECT stage,count(*)::int AS total FROM company_leads WHERE organization_id=$1 AND created_at::date BETWEEN $2 AND $3 GROUP BY stage ORDER BY total DESC',
      [actor.organization_id,since,until]),
    sql('SELECT stage,count(*)::int AS total FROM candidates WHERE organization_id=$1 AND created_at::date BETWEEN $2 AND $3 GROUP BY stage ORDER BY total DESC',
      [actor.organization_id,since,until]),
    sql('SELECT stage,count(*)::int AS total FROM applications WHERE organization_id=$1 AND created_at::date BETWEEN $2 AND $3 GROUP BY stage ORDER BY total DESC',
      [actor.organization_id,since,until]),
    sql(`SELECT u.id,u.full_name,
       count(DISTINCT a.id)::int AS logged_actions,
       count(DISTINCT f.id) FILTER(WHERE f.status='done')::int AS completed_followups
       FROM users u LEFT JOIN activities a ON a.actor_id=u.id AND a.created_at::date BETWEEN $2 AND $3
       LEFT JOIN followups f ON f.completed_by=u.id AND f.completed_at::date BETWEEN $2 AND $3
       WHERE u.organization_id=$1 GROUP BY u.id ORDER BY logged_actions DESC`,
      [actor.organization_id,since,until]),
  ]);
  const overdue=await one<{total:number}>(
    `SELECT count(*)::int AS total FROM followups WHERE organization_id=$1 AND status='pending' AND due_at<now()`,
    [actor.organization_id]);
  return json({data:{company,candidates,applications,employees,overdue:overdue?.total||0,from:since,to:until}});
});
