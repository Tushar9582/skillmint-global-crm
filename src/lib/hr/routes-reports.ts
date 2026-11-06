import { HttpError } from '@/lib/auth';
import { one, sql } from '@/lib/db';
import { json } from '@/lib/http';
import { can, monthRangeOf } from './core';
import { localDate } from './time';
import { EMPLOYEE_COLUMNS, EMPLOYEE_FROM, csvResponse, getSettings, need, type Row, type ServerRoute } from './server';
import { monthDays, todayRegister } from './routes-core';

const count = async (query: string, args: unknown[]) => Number((await one<{ n: number }>(query, args))?.n ?? 0);

export const reportRoutes: ServerRoute[] = [
  { method: 'GET', path: 'dashboard', handle: async ctx => {
    const { actor } = ctx; const orgId = actor.organization_id;
    if (!['employees.view', 'attendance.view_all', 'leave.manage', 'overtime.manage', 'shifts.manage'].some(p => can(actor.role, p))) throw new HttpError(403, 'You do not have permission for this action');
    const view = can(actor.role, 'attendance.view_all'); const today = view ? await todayRegister(orgId) : null;
    return json({ data: {
      date: today?.date ?? localDate(new Date(), (await getSettings(orgId)).timezone),
      total_employees: can(actor.role, 'employees.view') || view ? await count('SELECT count(*)::int AS n FROM hr_employees WHERE organization_id=$1 AND active=true', [orgId]) : null,
      present_today: today?.summary.present ?? null, absent_today: today?.summary.absent ?? null, on_leave: today?.summary.on_leave ?? null, missing_punch: today?.summary.missing_punch ?? null,
      pending_leave: can(actor.role, 'leave.manage') ? await count(`SELECT count(*)::int AS n FROM hr_leave_requests WHERE organization_id=$1 AND status='pending'`, [orgId]) : null,
      active_shifts: can(actor.role, 'shifts.manage') ? await count('SELECT count(*)::int AS n FROM hr_shifts WHERE organization_id=$1 AND active=true', [orgId]) : null,
      pending_overtime: can(actor.role, 'overtime.manage') ? await count(`SELECT count(*)::int AS n FROM hr_overtime_requests WHERE organization_id=$1 AND status='pending'`, [orgId]) : null,
    } });
  } },

  { method: 'GET', path: 'reports/attendance', handle: async ctx => {
    need(ctx.actor, 'hr.reports'); const orgId = ctx.actor.organization_id; const [from, to] = monthRangeOf(ctx.query.get('month'));
    const settings = await getSettings(orgId); const today = localDate(new Date(), settings.timezone);
    const employees = await sql<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 AND (e.active=true OR e.exit_date>=$2::date) ORDER BY e.employee_code`, [orgId, from]);
    const data: Row[] = [];
    for (const emp of employees) {
      const days = await monthDays(orgId, emp, from, to, settings.timezone, today); const by = (...s: string[]) => days.filter(d => s.includes(String(d.status))).length;
      const recs = days.map(d => d.record as Row | null).filter((r): r is Row => Boolean(r));
      data.push({ employee_code: emp.employee_code, employee_name: emp.full_name, department: emp.department, present: by('present', 'in_progress'), half_day: by('half_day'), absent: by('absent'), missing_punch: by('missing_punch'),
        leave: by('leave', 'half_day_leave'), holidays: by('holiday'), weekly_off: by('weekly_off'), late_count: recs.filter(r => Number(r.late_minutes) > 0).length, late_minutes: recs.reduce((s, r) => s + Number(r.late_minutes), 0),
        early_count: recs.filter(r => Number(r.early_minutes) > 0).length, worked_hours: Math.round(recs.reduce((s, r) => s + Number(r.worked_minutes), 0) / 6) / 10, overtime_hours: Math.round(recs.reduce((s, r) => s + Number(r.overtime_minutes), 0) / 6) / 10 });
    }
    if (ctx.query.get('format') === 'csv') return csvResponse(`attendance-summary-${ctx.query.get('month')}.csv`, ['Employee ID', 'Name', 'Department', 'Present', 'Half Day', 'Absent', 'Missing Punch', 'Leave', 'Late Count', 'Late Minutes', 'Early Count', 'Worked Hours', 'Overtime Hours'],
      data.map(r => [r.employee_code, r.employee_name, r.department, r.present, r.half_day, r.absent, r.missing_punch, r.leave, r.late_count, r.late_minutes, r.early_count, r.worked_hours, r.overtime_hours]));
    return json({ data });
  } },

  { method: 'GET', path: 'reports/leave', handle: async ctx => {
    need(ctx.actor, 'hr.reports'); const year = Number(ctx.query.get('year') || new Date().getFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Invalid year');
    const data = await sql(`SELECT e.employee_code,e.full_name AS employee_name,e.department,t.name AS leave_type,
        COALESCE(sum(CASE WHEN r.status='approved' THEN CASE WHEN r.half_day THEN 0.5 ELSE (SELECT count(*) FROM unnest(r.counted_dates) d WHERE extract(year FROM d)=$2) END END),0)::float AS approved_days,
        COALESCE(sum(CASE WHEN r.status='pending' THEN CASE WHEN r.half_day THEN 0.5 ELSE (SELECT count(*) FROM unnest(r.counted_dates) d WHERE extract(year FROM d)=$2) END END),0)::float AS pending_days
      FROM hr_leave_requests r JOIN hr_employees e ON e.id=r.employee_id JOIN hr_leave_types t ON t.id=r.leave_type_id
      WHERE r.organization_id=$1 AND r.status IN ('approved','pending') AND r.start_date<=make_date($2,12,31) AND r.end_date>=make_date($2,1,1)
      GROUP BY e.id,t.id ORDER BY e.employee_code,t.name`, [orgId(ctx), year]);
    return json({ data, year });
  } },
];
const orgId = (ctx: { actor: { organization_id: string } }) => ctx.actor.organization_id;
