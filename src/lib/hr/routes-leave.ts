import type { PoolClient } from 'pg';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { json } from '@/lib/http';
import { UUID_RE, assertDate, can } from './core';
import { addDays, localDate, monthRange } from './time';
import { v, has } from './validate';
import { countLeave, daysByYear, leaveBalance, assertSufficientBalance, spansOverlap } from './leave';
import { approvedMinutes, validateRequestedMinutes } from './overtime';
import { assertMonthOpen, buildUpdate, csvResponse, dayTypeResolver, ensureProfiles, getSettings, jsonBody, myEmployee, need, type Ctx, type Row, type ServerRoute } from './server';
import { loadEmployee } from './routes-core';

const SHIFT_KINDS = ['morning', 'evening', 'night', 'custom'] as const;
const SHIFT_COLS = `id,name,kind,to_char(start_time,'HH24:MI') AS start_time,to_char(end_time,'HH24:MI') AS end_time,break_minutes,grace_minutes,weekly_off,working_days,active`;

async function guarded<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) { if ((error as { code?: string }).code === '23505') throw new HttpError(409, message); throw error; }
}
const monthParam = (value: string | null) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new HttpError(400, 'Month must be YYYY-MM');
  return monthRange(Number(m[1]), Number(m[2]));
};

function parseShift(data: Row, create: boolean): Row {
  const out: Row = {};
  if (create || has(data, 'name')) out.name = v.str(data.name, 'Shift name', { required: true, max: 80 });
  if (create || has(data, 'kind')) out.kind = v.oneOf(data.kind ?? 'custom', 'Shift type', SHIFT_KINDS, true);
  if (create || has(data, 'start_time')) out.start_time = v.time(data.start_time, 'Start time');
  if (create || has(data, 'end_time')) out.end_time = v.time(data.end_time, 'End time');
  if (create || has(data, 'break_minutes')) out.break_minutes = v.num(data.break_minutes ?? 0, 'Break', { max: 240 });
  if (create || has(data, 'grace_minutes')) out.grace_minutes = v.num(data.grace_minutes ?? 0, 'Grace period', { max: 120 });
  if (create || has(data, 'weekly_off')) out.weekly_off = v.ints(data.weekly_off ?? [0], 'Weekly off', 0, 6);
  if (create || has(data, 'working_days')) out.working_days = v.ints(data.working_days ?? [1, 2, 3, 4, 5, 6], 'Working days', 0, 6);
  if (has(data, 'active')) out.active = v.bool(data.active);
  return out;
}

// ---- Leave helpers ----
async function ensureLeaveTypes(orgId: string) {
  const exists = await one('SELECT 1 FROM hr_leave_types WHERE organization_id=$1 LIMIT 1', [orgId]);
  if (exists) return;
  await sql(`INSERT INTO hr_leave_types(organization_id,name,code,annual_quota,paid,allow_negative) VALUES
    ($1,'Casual Leave','CL',12,true,false),($1,'Sick Leave','SL',8,true,false),($1,'Earned Leave','EL',15,true,false),($1,'Loss of Pay','LOP',0,false,true)
    ON CONFLICT DO NOTHING`, [orgId]);
}
async function ensureBalances(orgId: string, employeeId: string, year: number, client?: PoolClient) {
  await sql(`INSERT INTO hr_leave_balances(organization_id,employee_id,leave_type_id,year,allocated)
    SELECT $1,$2,t.id,$3,t.annual_quota FROM hr_leave_types t WHERE t.organization_id=$1 AND t.active=true
    ON CONFLICT DO NOTHING`, [orgId, employeeId, year], client);
}
const USED_SQL = (status: string) => `COALESCE((SELECT sum(CASE WHEN r.half_day THEN 0.5 ELSE (SELECT count(*) FROM unnest(r.counted_dates) d WHERE extract(year FROM d)=b.year) END)
  FROM hr_leave_requests r WHERE r.organization_id=b.organization_id AND r.employee_id=b.employee_id AND r.leave_type_id=b.leave_type_id AND r.status='${status}'),0)`;

async function balancesFor(orgId: string, employeeId: string, year: number, client?: PoolClient) {
  await ensureLeaveTypes(orgId);
  await ensureBalances(orgId, employeeId, year, client);
  const rows = await sql<Row>(`SELECT b.id,b.leave_type_id,t.name,t.code,t.paid,t.allow_negative,b.year,b.allocated::float AS allocated,b.adjustment::float AS adjustment,
      ${USED_SQL('approved')}::float AS used,${USED_SQL('pending')}::float AS pending
    FROM hr_leave_balances b JOIN hr_leave_types t ON t.id=b.leave_type_id WHERE b.organization_id=$1 AND b.employee_id=$2 AND b.year=$3 AND t.active=true ORDER BY t.name`, [orgId, employeeId, year], client);
  return rows.map((r): Row => ({ ...r, ...leaveBalance({ allocated: Number(r.allocated), adjustment: Number(r.adjustment), used: Number(r.used), pending: Number(r.pending) }) }));
}

async function requestRow(orgId: string, id: string, client?: PoolClient): Promise<Row> {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Request not found');
  const row = await one<Row>(`SELECT r.*,r.start_date::text AS start_date,r.end_date::text AS end_date,r.counted_dates::text[] AS counted_dates FROM hr_leave_requests r WHERE r.id=$1 AND r.organization_id=$2 ${client ? 'FOR UPDATE' : ''}`, [id, orgId], client);
  if (!row) throw new HttpError(404, 'Request not found');
  return row;
}

async function assertNoOverlap(orgId: string, employeeId: string, span: { start_date: string; end_date: string; half_day: boolean; half_day_part: string | null }, ignoreId: string | null, client: PoolClient) {
  const others = await sql<Row>(`SELECT id,start_date::text AS start_date,end_date::text AS end_date,half_day,half_day_part FROM hr_leave_requests
    WHERE organization_id=$1 AND employee_id=$2 AND status IN ('pending','approved') AND start_date<=$4::date AND end_date>=$3::date AND ($5::uuid IS NULL OR id<>$5::uuid)`,
    [orgId, employeeId, span.start_date, span.end_date, ignoreId], client);
  if (others.some(o => spansOverlap(span, o as never))) throw new HttpError(409, 'This request overlaps an existing pending or approved leave');
}

const REQUEST_SELECT = `SELECT r.id,r.employee_id,r.leave_type_id,r.start_date::text AS start_date,r.end_date::text AS end_date,r.half_day,r.half_day_part,r.days::float AS days,
  r.reason,r.status,r.decision_note,r.decided_at,r.created_at,t.name AS leave_type,t.paid,e.full_name AS employee_name,e.employee_code,e.department
  FROM hr_leave_requests r JOIN hr_leave_types t ON t.id=r.leave_type_id JOIN hr_employees e ON e.id=r.employee_id`;

function leaveRoutes(): ServerRoute[] {
  return [
    { method: 'GET', path: 'leave/types', handle: async ctx => {
      await ensureLeaveTypes(ctx.actor.organization_id);
      return json({ data: await sql(`SELECT id,name,code,annual_quota::float AS annual_quota,paid,count_weekends,count_holidays,allow_negative,requires_approval,active FROM hr_leave_types WHERE organization_id=$1 ORDER BY name`, [ctx.actor.organization_id]) });
    } },
    { method: 'POST', path: 'leave/types', handle: async ctx => json({ data: await saveType(ctx, null) }, 201) },
    { method: 'PATCH', path: 'leave/types/:id', handle: async ctx => json({ data: await saveType(ctx, ctx.params.id) }) },

    { method: 'GET', path: 'leave/balances', handle: async ctx => {
      const own = await myEmployee(ctx.actor);
      const employeeId = ctx.query.get('employee_id') || String(own.id);
      if (employeeId !== own.id) { need(ctx.actor, 'leave.manage'); await loadEmployee(ctx.actor.organization_id, employeeId); }
      const year = Number(ctx.query.get('year') || localDate(new Date(), (await getSettings(ctx.actor.organization_id)).timezone).slice(0, 4));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Invalid year');
      return json({ data: await balancesFor(ctx.actor.organization_id, employeeId, year), year });
    } },
    { method: 'POST', path: 'leave/balances', handle: async ctx => {
      need(ctx.actor, 'leave.manage');
      const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
      const employee = await loadEmployee(orgId, String(v.uuid(d.employee_id, 'Employee', true)));
      const type = await one<Row>('SELECT id FROM hr_leave_types WHERE id=$1 AND organization_id=$2', [v.uuid(d.leave_type_id, 'Leave type', true), orgId]);
      if (!type) throw new HttpError(404, 'Leave type not found');
      const year = v.num(d.year, 'Year', { min: 2000, max: 2100, required: true })!;
      const reason = v.str(d.reason, 'Reason', { required: true, max: 300 });
      const change: Row = {};
      if (has(d, 'allocated')) change.allocated = v.num(d.allocated, 'Allocated days', { max: 366, required: true });
      if (has(d, 'adjustment')) change.adjustment = v.num(d.adjustment, 'Adjustment', { min: -366, max: 366, required: true });
      if (!Object.keys(change).length) throw new HttpError(400, 'Nothing to change');
      await transaction(async client => {
        await ensureBalances(orgId, String(employee.id), year, client);
        const keys = Object.keys(change);
        await sql(`UPDATE hr_leave_balances SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},updated_by=$${keys.length + 1},updated_at=now()
          WHERE organization_id=$${keys.length + 2} AND employee_id=$${keys.length + 3} AND leave_type_id=$${keys.length + 4} AND year=$${keys.length + 5}`,
          [...keys.map(k => change[k]), ctx.actor.id, orgId, employee.id, type.id, year], client);
        await sql(`INSERT INTO hr_leave_balance_log(organization_id,employee_id,leave_type_id,year,change,reason,changed_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [orgId, employee.id, type.id, year, JSON.stringify(change), reason, ctx.actor.id], client);
        await audit(ctx.actor, 'leave_balance_adjust', 'hr_leave_balances', String(employee.id), { ...change, reason }, client);
      });
      return json({ data: await balancesFor(orgId, String(employee.id), year) });
    } },

    { method: 'GET', path: 'leave/requests', handle: async ctx => {
      const own = await myEmployee(ctx.actor); const all = can(ctx.actor.role, 'leave.manage');
      const args: unknown[] = [ctx.actor.organization_id]; const where = ['r.organization_id=$1'];
      const add = (t: string, val: unknown) => { args.push(val); where.push(t.replaceAll('?', `$${args.length}`)); };
      const target = all ? ctx.query.get('employee_id') : String(own.id); if (target) add('r.employee_id=?', v.uuid(target, 'Employee'));
      const status = ctx.query.get('status'); if (status) add('r.status=?', v.oneOf(status, 'Status', ['pending', 'approved', 'rejected', 'cancelled'] as const));
      const from = ctx.query.get('from'); if (from) add('r.end_date>=?::date', assertDate(from, 'From date'));
      const to = ctx.query.get('to'); if (to) add('r.start_date<=?::date', assertDate(to, 'To date'));
      return json({ data: await sql(`${REQUEST_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 500`, args) });
    } },

    { method: 'POST', path: 'leave/requests', handle: async ctx => {
      need(ctx.actor, 'leave.self');
      const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
      const employee = await myEmployee(ctx.actor);
      if (!employee.active) throw new HttpError(403, 'Your employee record is inactive');
      const start = v.date(d.start_date, 'Start date', true)!; const end = v.date(d.end_date ?? d.start_date, 'End date', true)!;
      const half = v.bool(d.half_day); const part = half ? v.oneOf(d.half_day_part ?? 'first', 'Half-day part', ['first', 'second'] as const, true) : null;
      const reason = v.str(d.reason, 'Leave reason', { required: true, max: 500 });
      const type = await one<Row>('SELECT * FROM hr_leave_types WHERE id=$1 AND organization_id=$2 AND active=true', [v.uuid(d.leave_type_id, 'Leave type', true), orgId]);
      if (!type) throw new HttpError(404, 'Leave type not found');
      const settings = await getSettings(orgId); const today = localDate(new Date(), settings.timezone);
      if (employee.joining_date && start < String(employee.joining_date)) throw new HttpError(400, 'Leave cannot start before your joining date');
      if (start < addDays(today, -30)) throw new HttpError(400, 'Leave can be requested for at most 30 days in the past. Ask HR for older dates.');
      const created = await transaction(async client => {
        await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`leave:${employee.id}`], client);
        await assertMonthOpen(orgId, [start, end], client);
        const resolver = await dayTypeResolver(orgId, employee, start, end, client);
        const { dates, days } = countLeave({ start, end, half_day: half, dayTypeAt: resolver.at, rule: { count_weekends: Boolean(type.count_weekends), count_holidays: Boolean(type.count_holidays) } });
        await assertNoOverlap(orgId, String(employee.id), { start_date: start, end_date: end, half_day: half, half_day_part: part }, null, client);
        const byYear = daysByYear(dates, half); const remaining: Record<number, number> = {};
        for (const y of Object.keys(byYear).map(Number)) {
          const b = (await balancesFor(orgId, String(employee.id), y, client)).find(x => x.leave_type_id === type.id);
          remaining[y] = Number(b?.remaining ?? 0);
        }
        assertSufficientBalance(byYear, remaining, Boolean(type.allow_negative));
        const auto = !type.requires_approval;
        const row = await one<Row>(`INSERT INTO hr_leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,half_day,half_day_part,days,counted_dates,reason,status,decided_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date[],$10,$11,$12) RETURNING id,status,days`,
          [orgId, employee.id, type.id, start, end, half, part, days, dates, reason, auto ? 'approved' : 'pending', auto ? new Date() : null], client);
        await audit(ctx.actor, 'leave_request', 'hr_leave_requests', String(row!.id), { start, end, days }, client);
        return row;
      });
      return json({ data: created }, 201);
    } },

    { method: 'POST', path: 'leave/requests/:id/decision', handle: async ctx => {
      need(ctx.actor, 'leave.manage');
      const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
      const decision = v.oneOf(d.decision, 'Decision', ['approved', 'rejected'] as const, true)!; const note = v.str(d.note, 'Note', { max: 300 });
      const updated = await transaction(async client => {
        const req = await requestRow(orgId, ctx.params.id, client);
        if (req.status !== 'pending') throw new HttpError(409, `This request is already ${String(req.status)}`);
        await assertMonthOpen(orgId, req.counted_dates as string[], client);
        const employee = await loadEmployee(orgId, String(req.employee_id), client);
        if (employee.user_id === ctx.actor.id && ctx.actor.role !== 'admin') throw new HttpError(403, 'You cannot decide your own leave request');
        if (decision === 'approved') {
          await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`leave:${employee.id}`], client);
          await assertNoOverlap(orgId, String(employee.id), req as never, String(req.id), client);
          const type = (await one<Row>('SELECT * FROM hr_leave_types WHERE id=$1', [req.leave_type_id], client))!;
          const byYear = daysByYear(req.counted_dates as string[], Boolean(req.half_day)); const available: Record<number, number> = {};
          for (const y of Object.keys(byYear).map(Number)) {
            const b = (await balancesFor(orgId, String(employee.id), y, client)).find(x => x.leave_type_id === type.id);
            available[y] = b ? Number(b.total) - Number(b.used) : 0;
          }
          assertSufficientBalance(byYear, available, Boolean(type.allow_negative));
        }
        const row = await one<Row>(`UPDATE hr_leave_requests SET status=$1,decided_by=$2,decided_at=now(),decision_note=$3 WHERE id=$4 AND organization_id=$5 RETURNING id,status`, [decision, ctx.actor.id, note, req.id, orgId], client);
        await audit(ctx.actor, `leave_${decision}`, 'hr_leave_requests', String(req.id), { employee_id: employee.id }, client);
        return row;
      });
      return json({ data: updated });
    } },

    { method: 'POST', path: 'leave/requests/:id/cancel', handle: async ctx => {
      const orgId = ctx.actor.organization_id; const own = await myEmployee(ctx.actor);
      const settings = await getSettings(orgId); const today = localDate(new Date(), settings.timezone);
      const row = await transaction(async client => {
        const req = await requestRow(orgId, ctx.params.id, client);
        const mine = req.employee_id === own.id;
        if (!mine) need(ctx.actor, 'leave.manage');
        if (!['pending', 'approved'].includes(String(req.status))) throw new HttpError(409, `A ${String(req.status)} request cannot be cancelled`);
        await assertMonthOpen(orgId, req.counted_dates as string[], client);
        if (req.status === 'approved' && mine && !can(ctx.actor.role, 'leave.manage') && String(req.start_date) <= today) throw new HttpError(409, 'Approved leave that has started can only be cancelled by HR');
        const updated = await one<Row>(`UPDATE hr_leave_requests SET status='cancelled',decided_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,status`, [req.id, orgId], client);
        await audit(ctx.actor, 'leave_cancel', 'hr_leave_requests', String(req.id), {}, client);
        return updated;
      });
      return json({ data: row });
    } },

    { method: 'GET', path: 'leave/calendar', handle: async ctx => {
      need(ctx.actor, 'leave.manage');
      const [from, to] = monthParam(ctx.query.get('month'));
      return json({ data: await sql(`${REQUEST_SELECT} WHERE r.organization_id=$1 AND r.status IN ('pending','approved') AND r.start_date<=$3::date AND r.end_date>=$2::date ORDER BY r.start_date`, [ctx.actor.organization_id, from, to]), from, to });
    } },
  ];
}

async function saveType(ctx: Ctx, id: string | null): Promise<Row> {
  need(ctx.actor, 'leave.manage');
  const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const out: Row = {};
  if (!id || has(d, 'name')) out.name = v.str(d.name, 'Name', { required: true, max: 80 });
  if (!id || has(d, 'code')) out.code = v.str(d.code, 'Code', { required: true, max: 12 })?.toUpperCase();
  if (!id || has(d, 'annual_quota')) out.annual_quota = v.num(d.annual_quota ?? 0, 'Annual quota', { max: 366 });
  const flags: Record<string, boolean> = { paid: true, count_weekends: false, count_holidays: false, allow_negative: false, requires_approval: true, active: true };
  for (const [k, fallback] of Object.entries(flags)) { if (has(d, k)) out[k] = v.bool(d[k]); else if (!id) out[k] = fallback; }
  const row = await guarded(async () => {
    if (!id) { const keys = Object.keys(out); return one<Row>(`INSERT INTO hr_leave_types(organization_id,${keys.join(',')}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`, [orgId, ...keys.map(k => out[k])]); }
    const q = buildUpdate('hr_leave_types', out, orgId, id, ''); return one<Row>(q.text, q.args);
  }, 'A leave type with this code already exists');
  if (!row) throw new HttpError(404, 'Leave type not found');
  await audit(ctx.actor, id ? 'leave_type_update' : 'leave_type_create', 'hr_leave_types', String(row.id), { code: row.code });
  return row;
}

// ---- Overtime ----
const OT_SELECT = `SELECT o.id,o.employee_id,o.work_date::text AS work_date,o.calculated_minutes,o.requested_minutes,o.approved_minutes,o.day_type,o.rate_multiplier::float AS rate_multiplier,
  o.reason,o.status,o.decision_note,o.decided_at,o.created_at,e.full_name AS employee_name,e.employee_code,e.department FROM hr_overtime_requests o JOIN hr_employees e ON e.id=o.employee_id`;

function overtimeRoutes(): ServerRoute[] {
  return [
    { method: 'GET', path: 'overtime', handle: async ctx => {
      const own = await myEmployee(ctx.actor); const all = can(ctx.actor.role, 'overtime.manage');
      const args: unknown[] = [ctx.actor.organization_id]; const where = ['o.organization_id=$1'];
      const add = (t: string, val: unknown) => { args.push(val); where.push(t.replaceAll('?', `$${args.length}`)); };
      const target = all ? ctx.query.get('employee_id') : String(own.id); if (target) add('o.employee_id=?', v.uuid(target, 'Employee'));
      const status = ctx.query.get('status'); if (status) add('o.status=?', v.oneOf(status, 'Status', ['pending', 'approved', 'rejected'] as const));
      const month = ctx.query.get('month'); if (month) { const [f, t] = monthParam(month); add('o.work_date>=?::date', f); add('o.work_date<=?::date', t); }
      return json({ data: await sql(`${OT_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.work_date DESC LIMIT 500`, args) });
    } },
    { method: 'GET', path: 'overtime/eligible', handle: async ctx => {
      const own = await myEmployee(ctx.actor); const settings = await getSettings(ctx.actor.organization_id);
      const today = localDate(new Date(), settings.timezone);
      const data = await sql(`SELECT a.id AS attendance_id,a.work_date::text AS work_date,a.overtime_minutes AS calculated_minutes FROM hr_attendance a
        WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.overtime_minutes>0 AND a.punch_out IS NOT NULL AND a.work_date>=$3::date
          AND NOT EXISTS (SELECT 1 FROM hr_overtime_requests o WHERE o.employee_id=a.employee_id AND o.work_date=a.work_date AND o.status<>'rejected') ORDER BY a.work_date DESC`,
        [ctx.actor.organization_id, own.id, addDays(today, -60)]);
      return json({ data, requires_approval: settings.overtime_requires_approval });
    } },
    { method: 'POST', path: 'overtime', handle: async ctx => {
      need(ctx.actor, 'overtime.self');
      const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const employee = await myEmployee(ctx.actor);
      const date = v.date(d.work_date, 'Work date', true)!; const reason = v.str(d.reason, 'Reason', { required: true, max: 400 });
      const created = await transaction(async client => {
        await assertMonthOpen(orgId, date, client);
        const att = await one<Row>(`SELECT id,overtime_minutes FROM hr_attendance WHERE organization_id=$1 AND employee_id=$2 AND work_date=$3::date AND punch_out IS NOT NULL`, [orgId, employee.id, date], client);
        if (!att) throw new HttpError(409, 'No completed attendance record exists for that date');
        const calculated = Number(att.overtime_minutes);
        const requested = validateRequestedMinutes(calculated, d.requested_minutes === undefined || d.requested_minutes === '' ? null : Number(d.requested_minutes));
        const resolver = await dayTypeResolver(orgId, employee, date, date, client);
        const dayType = resolver.at(date);
        const existing = await one<Row>('SELECT id,status FROM hr_overtime_requests WHERE organization_id=$1 AND employee_id=$2 AND work_date=$3::date', [orgId, employee.id, date], client);
        if (existing && existing.status !== 'rejected') throw new HttpError(409, 'An overtime request already exists for that date');
        const args = [orgId, employee.id, att.id, date, calculated, requested, dayType, reason];
        const row = existing
          ? await one<Row>(`UPDATE hr_overtime_requests SET attendance_id=$3,calculated_minutes=$5,requested_minutes=$6,day_type=$7,reason=$8,status='pending',approved_minutes=NULL,decided_by=NULL,decided_at=NULL,decision_note=NULL
              WHERE id=$9 RETURNING id,status`, [...args, existing.id], client)
          : await one<Row>(`INSERT INTO hr_overtime_requests(organization_id,employee_id,attendance_id,work_date,calculated_minutes,requested_minutes,day_type,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`, args, client);
        await audit(ctx.actor, 'overtime_request', 'hr_overtime_requests', String(row!.id), { date, requested }, client);
        return row;
      });
      return json({ data: created }, 201);
    } },
    { method: 'POST', path: 'overtime/:id/decision', handle: async ctx => {
      need(ctx.actor, 'overtime.manage');
      const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
      const decision = v.oneOf(d.decision, 'Decision', ['approved', 'rejected'] as const, true)!; const note = v.str(d.note, 'Note', { max: 300 });
      const row = await transaction(async client => {
        const req = await one<Row>('SELECT *,work_date::text AS wd FROM hr_overtime_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE', [ctx.params.id, orgId], client);
        if (!req) throw new HttpError(404, 'Request not found');
        if (req.status !== 'pending') throw new HttpError(409, `This request is already ${String(req.status)}`);
        await assertMonthOpen(orgId, String(req.wd), client);
        const employee = await loadEmployee(orgId, String(req.employee_id), client);
        if (employee.user_id === ctx.actor.id && ctx.actor.role !== 'admin') throw new HttpError(403, 'You cannot decide your own overtime request');
        const minutes = approvedMinutes(Number(req.requested_minutes), decision, d.approved_minutes === undefined || d.approved_minutes === '' ? null : Number(d.approved_minutes));
        const settings = await getSettings(orgId, client);
        const multiplier = req.day_type === 'holiday' ? settings.overtime_holiday_multiplier : req.day_type === 'weekly_off' ? settings.overtime_weekoff_multiplier : settings.overtime_weekday_multiplier;
        const updated = await one<Row>(`UPDATE hr_overtime_requests SET status=$1,approved_minutes=$2,rate_multiplier=$3,decided_by=$4,decided_at=now(),decision_note=$5 WHERE id=$6 RETURNING id,status,approved_minutes`,
          [decision, minutes, multiplier, ctx.actor.id, note, req.id], client);
        await audit(ctx.actor, `overtime_${decision}`, 'hr_overtime_requests', String(req.id), { minutes }, client);
        return updated;
      });
      return json({ data: row });
    } },
    { method: 'GET', path: 'overtime/report', handle: async ctx => { need(ctx.actor, 'overtime.manage'); return json({ data: await overtimeReport(ctx.actor.organization_id, ctx.query.get('month')) }); } },
    { method: 'GET', path: 'overtime/export', handle: async ctx => {
      need(ctx.actor, 'overtime.manage');
      const rows = await overtimeReport(ctx.actor.organization_id, ctx.query.get('month'));
      return csvResponse(`overtime-${ctx.query.get('month')}.csv`, ['Employee ID', 'Name', 'Department', 'Calculated Hours', 'Requested Hours', 'Approved Hours', 'Pending Requests'],
        rows.map(r => [r.employee_code, r.employee_name, r.department, r.calculated_hours, r.requested_hours, r.approved_hours, r.pending_requests]));
    } },
  ];
}

async function overtimeReport(orgId: string, month: string | null) {
  const [from, to] = monthParam(month);
  return sql<Row>(`SELECT e.employee_code,e.full_name AS employee_name,e.department,
      round(COALESCE((SELECT sum(a.overtime_minutes) FROM hr_attendance a WHERE a.employee_id=e.id AND a.work_date BETWEEN $2::date AND $3::date),0)/60.0,2)::float AS calculated_hours,
      round(COALESCE(sum(o.requested_minutes),0)/60.0,2)::float AS requested_hours,
      round(COALESCE(sum(o.approved_minutes) FILTER (WHERE o.status='approved'),0)/60.0,2)::float AS approved_hours,
      count(o.id) FILTER (WHERE o.status='pending')::int AS pending_requests
    FROM hr_employees e LEFT JOIN hr_overtime_requests o ON o.employee_id=e.id AND o.work_date BETWEEN $2::date AND $3::date
    WHERE e.organization_id=$1 AND e.active=true GROUP BY e.id ORDER BY e.employee_code`, [orgId, from, to]);
}

// ---- Shifts and settings ----
function shiftRoutes(): ServerRoute[] {
  return [
    { method: 'GET', path: 'settings', handle: async ctx => json({ data: await getSettings(ctx.actor.organization_id) }) },
    { method: 'PATCH', path: 'settings', handle: async ctx => {
      const d = await jsonBody(ctx.request); const out: Row = {};
      const ot = ['overtime_requires_approval', 'overtime_min_minutes', 'overtime_weekday_multiplier', 'overtime_weekoff_multiplier', 'overtime_holiday_multiplier'];
      const general = ['timezone', 'default_weekly_off', 'standard_daily_hours', 'full_day_ratio', 'half_day_ratio', 'max_open_hours'];
      for (const k of Object.keys(d)) {
        if (ot.includes(k)) need(ctx.actor, 'overtime.manage'); else if (general.includes(k)) need(ctx.actor, 'shifts.manage'); else throw new HttpError(400, `Unknown setting ${k}`);
      }
      if (has(d, 'timezone')) { const tz = String(d.timezone); try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new HttpError(400, 'Unknown time zone'); } out.timezone = tz; }
      if (has(d, 'default_weekly_off')) out.default_weekly_off = v.ints(d.default_weekly_off, 'Weekly off', 0, 6);
      if (has(d, 'standard_daily_hours')) out.standard_daily_hours = v.num(d.standard_daily_hours, 'Standard hours', { min: 1, max: 24, required: true });
      if (has(d, 'full_day_ratio')) out.full_day_ratio = v.num(d.full_day_ratio, 'Full-day ratio', { min: 0.1, max: 1, required: true });
      if (has(d, 'half_day_ratio')) out.half_day_ratio = v.num(d.half_day_ratio, 'Half-day ratio', { min: 0.05, max: 1, required: true });
      if (has(d, 'max_open_hours')) out.max_open_hours = v.num(d.max_open_hours, 'Open punch window', { min: 1, max: 48, required: true });
      if (has(d, 'overtime_requires_approval')) out.overtime_requires_approval = v.bool(d.overtime_requires_approval);
      if (has(d, 'overtime_min_minutes')) out.overtime_min_minutes = v.num(d.overtime_min_minutes, 'Minimum overtime', { max: 600, required: true });
      for (const k of ['overtime_weekday_multiplier', 'overtime_weekoff_multiplier', 'overtime_holiday_multiplier']) if (has(d, k)) out[k] = v.num(d[k], 'Overtime rate', { max: 10, required: true });
      const current = await getSettings(ctx.actor.organization_id);
      if (Number(out.half_day_ratio ?? current.half_day_ratio) >= Number(out.full_day_ratio ?? current.full_day_ratio)) throw new HttpError(400, 'Half-day ratio must be lower than the full-day ratio');
      await getSettings(ctx.actor.organization_id);
      const keys = Object.keys(out);
      if (!keys.length) throw new HttpError(400, 'No settings provided');
      await sql(`UPDATE hr_settings SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},updated_at=now() WHERE organization_id=$${keys.length + 1}`, [...keys.map(k => out[k]), ctx.actor.organization_id]);
      await audit(ctx.actor, 'hr_settings_update', 'hr_settings', null, out);
      return json({ data: await getSettings(ctx.actor.organization_id) });
    } },

    { method: 'GET', path: 'shifts', handle: async ctx => {
      need(ctx.actor, 'shifts.manage');
      return json({ data: await sql(`SELECT ${SHIFT_COLS},(SELECT count(*)::int FROM hr_shift_assignments a WHERE a.shift_id=hr_shifts.id AND a.effective_to IS NULL) AS assigned FROM hr_shifts WHERE organization_id=$1 ORDER BY start_time,name`, [ctx.actor.organization_id]) });
    } },
    { method: 'POST', path: 'shifts', handle: async ctx => {
      need(ctx.actor, 'shifts.manage'); const values = parseShift(await jsonBody(ctx.request), true);
      checkShift(values);
      const keys = Object.keys(values);
      const row = await guarded(() => one<Row>(`INSERT INTO hr_shifts(organization_id,${keys.join(',')}) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id,name`, [ctx.actor.organization_id, ...keys.map(k => values[k])]), 'A shift with this name already exists');
      await audit(ctx.actor, 'shift_create', 'hr_shifts', String(row!.id), { name: values.name });
      return json({ data: row }, 201);
    } },
    { method: 'PATCH', path: 'shifts/:id', handle: async ctx => {
      need(ctx.actor, 'shifts.manage'); const orgId = ctx.actor.organization_id;
      const values = parseShift(await jsonBody(ctx.request), false);
      const current = await one<Row>(`SELECT ${SHIFT_COLS} FROM hr_shifts WHERE id=$1 AND organization_id=$2`, [ctx.params.id, orgId]);
      if (!current) throw new HttpError(404, 'Shift not found');
      checkShift({ ...current, ...values });
      if (values.active === false) {
        const open = await one('SELECT 1 FROM hr_shift_assignments WHERE shift_id=$1 AND effective_to IS NULL LIMIT 1', [ctx.params.id]);
        if (open) throw new HttpError(409, 'Reassign employees to another shift before deactivating this one');
      }
      const q = buildUpdate('hr_shifts', values, orgId, ctx.params.id, '');
      const row = await guarded(() => one<Row>(q.text, q.args), 'A shift with this name already exists');
      await audit(ctx.actor, 'shift_update', 'hr_shifts', ctx.params.id, { fields: Object.keys(values) });
      return json({ data: row });
    } },
    { method: 'GET', path: 'shifts/roster', handle: async ctx => {
      need(ctx.actor, 'shifts.manage'); await ensureProfiles(ctx.actor.organization_id);
      return json({ data: await sql(`SELECT e.id AS employee_id,e.full_name,e.employee_code,e.department,e.location,s.id AS shift_id,s.name AS shift_name,to_char(s.start_time,'HH24:MI') AS start_time,to_char(s.end_time,'HH24:MI') AS end_time,a.effective_from::text AS effective_from
        FROM hr_employees e LEFT JOIN LATERAL (SELECT * FROM hr_shift_assignments x WHERE x.employee_id=e.id AND x.effective_to IS NULL ORDER BY x.effective_from DESC LIMIT 1) a ON true
        LEFT JOIN hr_shifts s ON s.id=a.shift_id WHERE e.organization_id=$1 AND e.active=true ORDER BY e.employee_code`, [ctx.actor.organization_id]) });
    } },
    { method: 'POST', path: 'shifts/assign', handle: async ctx => {
      need(ctx.actor, 'shifts.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
      const shiftId = v.uuid(d.shift_id, 'Shift', true)!; const from = v.date(d.effective_from, 'Effective date', true)!; const reason = v.str(d.reason, 'Reason', { max: 300 });
      const result = await transaction(async client => {
        const shift = await one<Row>('SELECT id FROM hr_shifts WHERE id=$1 AND organization_id=$2 AND active=true', [shiftId, orgId], client);
        if (!shift) throw new HttpError(404, 'Shift not found or inactive');
        let ids: string[] = Array.isArray(d.employee_ids) ? d.employee_ids.map(x => String(v.uuid(x, 'Employee', true))) : [];
        if (d.department) ids = ids.concat((await sql<{ id: string }>('SELECT id FROM hr_employees WHERE organization_id=$1 AND active=true AND department=$2', [orgId, String(d.department)], client)).map(r => r.id));
        ids = [...new Set(ids)];
        if (!ids.length) throw new HttpError(400, 'Select at least one employee or a department');
        if (ids.length > 500) throw new HttpError(400, 'Too many employees in one assignment');
        let assigned = 0; const skipped: string[] = [];
        for (const id of ids) {
          const emp = await one<Row>('SELECT id,full_name,active FROM hr_employees WHERE id=$1 AND organization_id=$2', [id, orgId], client);
          if (!emp || !emp.active) { skipped.push(`${String(emp?.full_name ?? id)} (inactive or unknown)`); continue; }
          const current = await one<Row>(`SELECT id,shift_id,effective_from::text AS effective_from FROM hr_shift_assignments WHERE organization_id=$1 AND employee_id=$2 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`, [orgId, id], client);
          if (current && current.shift_id === shiftId) { skipped.push(`${String(emp.full_name)} (already on this shift)`); continue; }
          if (current && String(current.effective_from) >= from) { skipped.push(`${String(emp.full_name)} (choose a date after ${String(current.effective_from)})`); continue; }
          if (current) await sql('UPDATE hr_shift_assignments SET effective_to=$1::date-1 WHERE id=$2', [from, current.id], client);
          await sql('INSERT INTO hr_shift_assignments(organization_id,employee_id,shift_id,effective_from,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)', [orgId, id, shiftId, from, ctx.actor.id, reason], client);
          assigned++;
        }
        await audit(ctx.actor, 'shift_assign', 'hr_shifts', shiftId, { assigned, effective_from: from }, client);
        return { assigned, skipped };
      });
      return json({ data: result });
    } },
    { method: 'GET', path: 'shifts/history', handle: async ctx => {
      need(ctx.actor, 'shifts.manage'); const employeeId = v.uuid(ctx.query.get('employee_id'), 'Employee', true);
      return json({ data: await sql(`SELECT a.id,a.effective_from::text AS effective_from,a.effective_to::text AS effective_to,a.reason,a.created_at,s.name AS shift_name,u.full_name AS changed_by_name
        FROM hr_shift_assignments a JOIN hr_shifts s ON s.id=a.shift_id LEFT JOIN users u ON u.id=a.changed_by WHERE a.organization_id=$1 AND a.employee_id=$2 ORDER BY a.effective_from DESC,a.created_at DESC`, [ctx.actor.organization_id, employeeId]) });
    } },
  ];
}

function checkShift(s: Row) {
  if (s.start_time === s.end_time) throw new HttpError(400, 'Start and end time cannot be the same');
  const toMin = (t: unknown) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  let span = toMin(s.end_time) - toMin(s.start_time); if (span <= 0) span += 1440;
  if (Number(s.break_minutes ?? 0) >= span) throw new HttpError(400, 'Break must be shorter than the shift');
  const off = (s.weekly_off as number[]) ?? []; const work = (s.working_days as number[]) ?? [];
  if (off.some(d => work.includes(d))) throw new HttpError(400, 'A weekday cannot be both a weekly off and a working day');
}

export const leaveShiftRoutes: ServerRoute[] = [...shiftRoutes(), ...leaveRoutes(), ...overtimeRoutes()];
