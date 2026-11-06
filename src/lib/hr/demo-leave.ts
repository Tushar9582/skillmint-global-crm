'use client';

import { RuleError, can, monthRangeOf } from './core';
import { addDays, localDate } from './time';
import { DEFAULT_SHIFT, dayTypeFor, type DayType } from './attendance';
import { v, has } from './validate';
import { countLeave, daysByYear, leaveBalance, assertSufficientBalance, spansOverlap } from './leave';
import { approvedMinutes, validateRequestedMinutes } from './overtime';
import { need, nowIso, registerDemoModule, table, uid, eid, type DemoCtx, type DemoRoute, type Row, type Store } from './demo-hr';
import { demoAssertMonthOpen, demoHolidayDates, demoLeaveHooks, demoMonthDays, demoSettings, demoShiftAt, myEmployee } from './demo-core';

const find = (store: Store, name: string, id: string) => table(store, name).find(r => r.id === id);
function employee(store: Store, id: string): Row { const e = find(store, 'employees', id); if (!e) throw new RuleError(404, 'Employee not found'); return e; }
const dayTypeAt = (store: Store, emp: Row) => (date: string): DayType => dayTypeFor(date, demoShiftAt(store, String(emp.id), date) ?? DEFAULT_SHIFT, demoHolidayDates(store, emp, date, date), demoSettings(store));
const today = (store: Store) => localDate(new Date(), demoSettings(store).timezone);

demoLeaveHooks.cover = (store, employeeId, from, to) => {
  const cover = new Map<string, { half_day: boolean; paid: boolean }>();
  for (const r of table(store, 'leave_requests')) {
    if (r.employee_id !== employeeId || r.status !== 'approved') continue;
    const type = find(store, 'leave_types', String(r.leave_type_id));
    for (const d of r.counted_dates as string[]) if (d >= from && d <= to) cover.set(d, { half_day: Boolean(r.half_day), paid: Boolean(type?.paid ?? true) });
  }
  return cover;
};

function ensureBalances(store: Store, employeeId: string, year: number) {
  const balances = table(store, 'leave_balances');
  for (const t of table(store, 'leave_types').filter(x => x.active))
    if (!balances.some(b => b.employee_id === employeeId && b.leave_type_id === t.id && b.year === year))
      balances.push({ id: uid(), employee_id: employeeId, leave_type_id: t.id, year, allocated: Number(t.annual_quota), adjustment: 0 });
}
function balancesFor(store: Store, employeeId: string, year: number): Row[] {
  ensureBalances(store, employeeId, year);
  const reqs = table(store, 'leave_requests').filter(r => r.employee_id === employeeId);
  const count = (typeId: unknown, status: string) => reqs.filter(r => r.leave_type_id === typeId && r.status === status)
    .reduce((s, r) => s + (r.half_day ? 0.5 : (r.counted_dates as string[]).filter(d => d.startsWith(String(year))).length), 0);
  return table(store, 'leave_balances').filter(b => b.employee_id === employeeId && b.year === year).map((b): Row | null => {
    const t = find(store, 'leave_types', String(b.leave_type_id)); if (!t || !t.active) return null;
    return { id: b.id, leave_type_id: t.id, name: t.name, code: t.code, paid: t.paid, allow_negative: t.allow_negative, year, allocated: b.allocated, adjustment: b.adjustment,
      ...leaveBalance({ allocated: Number(b.allocated), adjustment: Number(b.adjustment), used: count(t.id, 'approved'), pending: count(t.id, 'pending') }) };
  }).filter((x): x is Row => x !== null).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
function assertNoOverlap(store: Store, employeeId: string, span: { start_date: string; end_date: string; half_day: boolean; half_day_part: string | null }, ignore: string | null) {
  if (table(store, 'leave_requests').some(o => o.employee_id === employeeId && ['pending', 'approved'].includes(String(o.status)) && o.id !== ignore && spansOverlap(span, o as never)))
    throw new RuleError(409, 'This request overlaps an existing pending or approved leave');
}
const withNames = (store: Store, r: Row): Row => {
  const e = find(store, 'employees', String(r.employee_id)); const t = find(store, 'leave_types', String(r.leave_type_id));
  return { ...r, employee_name: e?.full_name, employee_code: e?.employee_code, department: e?.department, leave_type: t?.name, paid: t?.paid };
};
const otWithNames = (store: Store, r: Row): Row => { const e = find(store, 'employees', String(r.employee_id)); return { ...r, employee_name: e?.full_name, employee_code: e?.employee_code, department: e?.department }; };

function saveType(c: DemoCtx, id: string | null): Row {
  need(c.actor, 'leave.manage'); const d = c.payload; const out: Row = {};
  if (!id || has(d, 'name')) out.name = v.str(d.name, 'Name', { required: true, max: 80 });
  if (!id || has(d, 'code')) out.code = v.str(d.code, 'Code', { required: true, max: 12 })?.toUpperCase();
  if (!id || has(d, 'annual_quota')) out.annual_quota = v.num(d.annual_quota ?? 0, 'Annual quota', { max: 366 });
  const flags: Record<string, boolean> = { paid: true, count_weekends: false, count_holidays: false, allow_negative: false, requires_approval: true, active: true };
  for (const [k, fallback] of Object.entries(flags)) { if (has(d, k)) out[k] = v.bool(d[k]); else if (!id) out[k] = fallback; }
  const types = table(c.store, 'leave_types');
  if (types.some(t => t.id !== id && t.code === (out.code ?? find(c.store, 'leave_types', String(id))?.code))) throw new RuleError(409, 'A leave type with this code already exists');
  if (!id) { const row = { id: uid(), ...out }; types.push(row); return row; }
  const row = find(c.store, 'leave_types', id); if (!row) throw new RuleError(404, 'Leave type not found'); return Object.assign(row, out);
}

function checkShift(s: Row) {
  if (s.start_time === s.end_time) throw new RuleError(400, 'Start and end time cannot be the same');
  const m = (t: unknown) => { const [h, x] = String(t).split(':').map(Number); return h * 60 + x; };
  let span = m(s.end_time) - m(s.start_time); if (span <= 0) span += 1440;
  if (Number(s.break_minutes ?? 0) >= span) throw new RuleError(400, 'Break must be shorter than the shift');
  if (((s.weekly_off as number[]) ?? []).some(d => ((s.working_days as number[]) ?? []).includes(d))) throw new RuleError(400, 'A weekday cannot be both a weekly off and a working day');
}
function parseShift(d: Row, create: boolean): Row {
  const out: Row = {};
  if (create || has(d, 'name')) out.name = v.str(d.name, 'Shift name', { required: true, max: 80 });
  if (create || has(d, 'kind')) out.kind = v.oneOf(d.kind ?? 'custom', 'Shift type', ['morning', 'evening', 'night', 'custom'] as const, true);
  if (create || has(d, 'start_time')) out.start_time = v.time(d.start_time, 'Start time');
  if (create || has(d, 'end_time')) out.end_time = v.time(d.end_time, 'End time');
  if (create || has(d, 'break_minutes')) out.break_minutes = v.num(d.break_minutes ?? 0, 'Break', { max: 240 });
  if (create || has(d, 'grace_minutes')) out.grace_minutes = v.num(d.grace_minutes ?? 0, 'Grace period', { max: 120 });
  if (create || has(d, 'weekly_off')) out.weekly_off = v.ints(d.weekly_off ?? [0], 'Weekly off', 0, 6);
  if (create || has(d, 'working_days')) out.working_days = v.ints(d.working_days ?? [1, 2, 3, 4, 5, 6], 'Working days', 0, 6);
  if (has(d, 'active')) out.active = v.bool(d.active);
  return out;
}

const routes: DemoRoute[] = [
  { method: 'GET', path: 'hr/dashboard', handle: c => {
    const role = c.actor.role; if (!['employees.view', 'attendance.view_all', 'leave.manage', 'overtime.manage', 'shifts.manage'].some(p => can(role, p))) throw new RuleError(403, 'You do not have permission for this action');
    const t = today(c.store); const rows = table(c.store, 'employees').filter(e => e.active).map(e => demoMonthDays(c.store, e, t, t)[0].status); const n = (...s: string[]) => rows.filter(x => s.includes(x)).length; const view = can(role, 'attendance.view_all');
    return { data: { date: t, total_employees: can(role, 'employees.view') || view ? rows.length : null, present_today: view ? n('present', 'in_progress', 'half_day') : null, absent_today: view ? n('not_punched', 'absent') : null, on_leave: view ? n('leave', 'half_day_leave') : null, missing_punch: view ? n('missing_punch') : null,
      pending_leave: can(role, 'leave.manage') ? table(c.store, 'leave_requests').filter(r => r.status === 'pending').length : null, active_shifts: can(role, 'shifts.manage') ? table(c.store, 'shifts').filter(s => s.active).length : null,
      pending_overtime: can(role, 'overtime.manage') ? table(c.store, 'overtime').filter(o => o.status === 'pending').length : null } };
  } },
  { method: 'GET', path: 'hr/reports/attendance', handle: c => {
    need(c.actor, 'hr.reports'); const [from, to] = monthRangeOf(c.query.get('month'));
    const data = table(c.store, 'employees').filter(e => e.active || (e.exit_date && String(e.exit_date) >= from)).map((e): Row => {
      const days = demoMonthDays(c.store, e, from, to); const by = (...s: string[]) => days.filter(d => s.includes(d.status)).length; const recs = days.map(d => d.record).filter((r): r is Row => Boolean(r));
      return { employee_code: e.employee_code, employee_name: e.full_name, department: e.department, present: by('present', 'in_progress'), half_day: by('half_day'), absent: by('absent'), missing_punch: by('missing_punch'), leave: by('leave', 'half_day_leave'), holidays: by('holiday'), weekly_off: by('weekly_off'),
        late_count: recs.filter(r => Number(r.late_minutes) > 0).length, late_minutes: recs.reduce((s, r) => s + Number(r.late_minutes), 0), early_count: recs.filter(r => Number(r.early_minutes) > 0).length,
        worked_hours: Math.round(recs.reduce((s, r) => s + Number(r.worked_minutes), 0) / 6) / 10, overtime_hours: Math.round(recs.reduce((s, r) => s + Number(r.overtime_minutes), 0) / 6) / 10 }; });
    return { data };
  } },
  { method: 'GET', path: 'hr/reports/leave', handle: c => {
    need(c.actor, 'hr.reports'); const year = Number(c.query.get('year') || new Date().getFullYear()); const out = new Map<string, Row>();
    for (const r of table(c.store, 'leave_requests').filter(x => ['approved', 'pending'].includes(String(x.status)))) {
      const e = find(c.store, 'employees', String(r.employee_id)); const t = find(c.store, 'leave_types', String(r.leave_type_id)); const days = r.half_day ? (String(r.start_date).startsWith(String(year)) ? 0.5 : 0) : (r.counted_dates as string[]).filter(d => d.startsWith(String(year))).length; if (!e || !t || !days) continue;
      const key = `${String(e.id)}|${String(t.id)}`; const row = out.get(key) ?? { employee_code: e.employee_code, employee_name: e.full_name, department: e.department, leave_type: t.name, approved_days: 0, pending_days: 0 };
      row[r.status === 'approved' ? 'approved_days' : 'pending_days'] = Number(row[r.status === 'approved' ? 'approved_days' : 'pending_days']) + days; out.set(key, row);
    }
    return { data: [...out.values()].sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code))), year };
  } },  { method: 'GET', path: 'hr/settings', handle: c => ({ data: demoSettings(c.store) }) },
  { method: 'PATCH', path: 'hr/settings', handle: c => {
    const s = demoSettings(c.store); const d = c.payload; const out: Row = {};
    const ot = ['overtime_requires_approval', 'overtime_min_minutes', 'overtime_weekday_multiplier', 'overtime_weekoff_multiplier', 'overtime_holiday_multiplier'];
    const general = ['timezone', 'default_weekly_off', 'standard_daily_hours', 'full_day_ratio', 'half_day_ratio', 'max_open_hours'];
    for (const k of Object.keys(d)) { if (ot.includes(k)) need(c.actor, 'overtime.manage'); else if (general.includes(k)) need(c.actor, 'shifts.manage'); else throw new RuleError(400, `Unknown setting ${k}`); }
    if (has(d, 'timezone')) { try { new Intl.DateTimeFormat('en', { timeZone: String(d.timezone) }); } catch { throw new RuleError(400, 'Unknown time zone'); } out.timezone = String(d.timezone); }
    if (has(d, 'default_weekly_off')) out.default_weekly_off = v.ints(d.default_weekly_off, 'Weekly off', 0, 6);
    if (has(d, 'standard_daily_hours')) out.standard_daily_hours = v.num(d.standard_daily_hours, 'Standard hours', { min: 1, max: 24, required: true });
    if (has(d, 'full_day_ratio')) out.full_day_ratio = v.num(d.full_day_ratio, 'Full-day ratio', { min: 0.1, max: 1, required: true });
    if (has(d, 'half_day_ratio')) out.half_day_ratio = v.num(d.half_day_ratio, 'Half-day ratio', { min: 0.05, max: 1, required: true });
    if (has(d, 'max_open_hours')) out.max_open_hours = v.num(d.max_open_hours, 'Open punch window', { min: 1, max: 48, required: true });
    if (has(d, 'overtime_requires_approval')) out.overtime_requires_approval = v.bool(d.overtime_requires_approval);
    if (has(d, 'overtime_min_minutes')) out.overtime_min_minutes = v.num(d.overtime_min_minutes, 'Minimum overtime', { max: 600, required: true });
    for (const k of ['overtime_weekday_multiplier', 'overtime_weekoff_multiplier', 'overtime_holiday_multiplier']) if (has(d, k)) out[k] = v.num(d[k], 'Overtime rate', { max: 10, required: true });
    if (Number(out.half_day_ratio ?? s.half_day_ratio) >= Number(out.full_day_ratio ?? s.full_day_ratio)) throw new RuleError(400, 'Half-day ratio must be lower than the full-day ratio');
    return { data: Object.assign(s, out) };
  } },

  { method: 'GET', path: 'hr/shifts', handle: c => { need(c.actor, 'shifts.manage');
    return { data: table(c.store, 'shifts').map((s): Row => ({ ...s, assigned: table(c.store, 'shift_assignments').filter(a => a.shift_id === s.id && !a.effective_to).length })).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time))) }; } },
  { method: 'POST', path: 'hr/shifts', handle: c => { need(c.actor, 'shifts.manage'); const values = parseShift(c.payload, true); checkShift(values);
    if (table(c.store, 'shifts').some(s => s.name === values.name)) throw new RuleError(409, 'A shift with this name already exists');
    const row = { id: uid(), active: true, ...values, created_at: nowIso() }; table(c.store, 'shifts').push(row); return { data: row }; } },
  { method: 'PATCH', path: 'hr/shifts/:id', handle: c => { need(c.actor, 'shifts.manage'); const s = find(c.store, 'shifts', c.params.id); if (!s) throw new RuleError(404, 'Shift not found');
    const values = parseShift(c.payload, false); checkShift({ ...s, ...values });
    if (values.active === false && table(c.store, 'shift_assignments').some(a => a.shift_id === s.id && !a.effective_to)) throw new RuleError(409, 'Reassign employees to another shift before deactivating this one');
    if (values.name && table(c.store, 'shifts').some(x => x.id !== s.id && x.name === values.name)) throw new RuleError(409, 'A shift with this name already exists');
    return { data: Object.assign(s, values) }; } },
  { method: 'GET', path: 'hr/shifts/roster', handle: c => { need(c.actor, 'shifts.manage');
    return { data: table(c.store, 'employees').filter(e => e.active).map(e => { const a = table(c.store, 'shift_assignments').filter(x => x.employee_id === e.id && !x.effective_to).sort((p, q) => String(q.effective_from).localeCompare(String(p.effective_from)))[0];
      const s = a ? find(c.store, 'shifts', String(a.shift_id)) : null;
      return { employee_id: e.id, full_name: e.full_name, employee_code: e.employee_code, department: e.department, location: e.location, shift_id: s?.id ?? null, shift_name: s?.name ?? null, start_time: s?.start_time ?? null, end_time: s?.end_time ?? null, effective_from: a?.effective_from ?? null }; }) }; } },
  { method: 'POST', path: 'hr/shifts/assign', handle: c => { need(c.actor, 'shifts.manage'); const d = c.payload;
    const shift = find(c.store, 'shifts', String(v.uuid(d.shift_id, 'Shift', true))); if (!shift || !shift.active) throw new RuleError(404, 'Shift not found or inactive');
    const from = v.date(d.effective_from, 'Effective date', true)!; const reason = v.str(d.reason, 'Reason', { max: 300 });
    let ids: string[] = Array.isArray(d.employee_ids) ? d.employee_ids.map(String) : [];
    if (d.department) ids = ids.concat(table(c.store, 'employees').filter(e => e.active && e.department === d.department).map(e => String(e.id)));
    ids = [...new Set(ids)]; if (!ids.length) throw new RuleError(400, 'Select at least one employee or a department');
    let assigned = 0; const skipped: string[] = [];
    for (const id of ids) {
      const emp = find(c.store, 'employees', id); if (!emp || !emp.active) { skipped.push(`${String(emp?.full_name ?? id)} (inactive or unknown)`); continue; }
      const cur = table(c.store, 'shift_assignments').filter(x => x.employee_id === id && !x.effective_to).sort((p, q) => String(q.effective_from).localeCompare(String(p.effective_from)))[0];
      if (cur && cur.shift_id === shift.id) { skipped.push(`${String(emp.full_name)} (already on this shift)`); continue; }
      if (cur && String(cur.effective_from) >= from) { skipped.push(`${String(emp.full_name)} (choose a date after ${String(cur.effective_from)})`); continue; }
      if (cur) cur.effective_to = addDays(from, -1);
      table(c.store, 'shift_assignments').push({ id: uid(), employee_id: id, shift_id: shift.id, effective_from: from, effective_to: null, reason, changed_by_name: c.actor.full_name, created_at: nowIso() }); assigned++;
    }
    return { data: { assigned, skipped } }; } },
  { method: 'GET', path: 'hr/shifts/history', handle: c => { need(c.actor, 'shifts.manage'); const id = c.query.get('employee_id');
    return { data: table(c.store, 'shift_assignments').filter(a => a.employee_id === id).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))
      .map(a => ({ ...a, shift_name: find(c.store, 'shifts', String(a.shift_id))?.name })) }; } },

  { method: 'GET', path: 'hr/leave/types', handle: c => ({ data: table(c.store, 'leave_types') }) },
  { method: 'POST', path: 'hr/leave/types', handle: c => ({ data: saveType(c, null) }) },
  { method: 'PATCH', path: 'hr/leave/types/:id', handle: c => ({ data: saveType(c, c.params.id) }) },
  { method: 'GET', path: 'hr/leave/balances', handle: c => {
    const id = c.query.get('employee_id') || c.actor.employee_id; if (id !== c.actor.employee_id) need(c.actor, 'leave.manage'); employee(c.store, id);
    const year = Number(c.query.get('year') || today(c.store).slice(0, 4)); return { data: balancesFor(c.store, id, year), year };
  } },
  { method: 'POST', path: 'hr/leave/balances', handle: c => {
    need(c.actor, 'leave.manage'); const d = c.payload; const emp = employee(c.store, String(v.uuid(d.employee_id, 'Employee', true)));
    const type = find(c.store, 'leave_types', String(v.uuid(d.leave_type_id, 'Leave type', true))); if (!type) throw new RuleError(404, 'Leave type not found');
    const year = v.num(d.year, 'Year', { min: 2000, max: 2100, required: true })!; v.str(d.reason, 'Reason', { required: true, max: 300 });
    const change: Row = {}; if (has(d, 'allocated')) change.allocated = v.num(d.allocated, 'Allocated days', { max: 366, required: true }); if (has(d, 'adjustment')) change.adjustment = v.num(d.adjustment, 'Adjustment', { min: -366, max: 366, required: true });
    if (!Object.keys(change).length) throw new RuleError(400, 'Nothing to change');
    ensureBalances(c.store, String(emp.id), year); Object.assign(table(c.store, 'leave_balances').find(b => b.employee_id === emp.id && b.leave_type_id === type.id && b.year === year)!, change);
    return { data: balancesFor(c.store, String(emp.id), year) };
  } },
  { method: 'GET', path: 'hr/leave/requests', handle: c => {
    const all = can(c.actor.role, 'leave.manage'); const target = all ? c.query.get('employee_id') : c.actor.employee_id; const status = c.query.get('status');
    return { data: table(c.store, 'leave_requests').filter(r => (!target || r.employee_id === target) && (!status || r.status === status)).map(r => withNames(c.store, r)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
  } },
  { method: 'POST', path: 'hr/leave/requests', handle: c => {
    need(c.actor, 'leave.self'); const d = c.payload; const emp = myEmployee(c); if (!emp.active) throw new RuleError(403, 'Your employee record is inactive');
    const start = v.date(d.start_date, 'Start date', true)!; const end = v.date(d.end_date ?? d.start_date, 'End date', true)!; const half = v.bool(d.half_day);
    const part = half ? v.oneOf(d.half_day_part ?? 'first', 'Half-day part', ['first', 'second'] as const, true) : null; const reason = v.str(d.reason, 'Leave reason', { required: true, max: 500 });
    const type = find(c.store, 'leave_types', String(v.uuid(d.leave_type_id, 'Leave type', true))); if (!type || !type.active) throw new RuleError(404, 'Leave type not found');
    if (emp.joining_date && start < String(emp.joining_date)) throw new RuleError(400, 'Leave cannot start before your joining date');
    if (start < addDays(today(c.store), -30)) throw new RuleError(400, 'Leave can be requested for at most 30 days in the past. Ask HR for older dates.');
    demoAssertMonthOpen(c.store, [start, end]);
    const { dates, days } = countLeave({ start, end, half_day: half, dayTypeAt: dayTypeAt(c.store, emp), rule: { count_weekends: Boolean(type.count_weekends), count_holidays: Boolean(type.count_holidays) } });
    assertNoOverlap(c.store, String(emp.id), { start_date: start, end_date: end, half_day: half, half_day_part: part }, null);
    const byYear = daysByYear(dates, half); const remaining: Record<number, number> = {};
    for (const y of Object.keys(byYear).map(Number)) remaining[y] = Number(balancesFor(c.store, String(emp.id), y).find(b => b.leave_type_id === type.id)?.remaining ?? 0);
    assertSufficientBalance(byYear, remaining, Boolean(type.allow_negative));
    const row = { id: uid(), employee_id: emp.id, leave_type_id: type.id, start_date: start, end_date: end, half_day: half, half_day_part: part, days, counted_dates: dates, reason, status: type.requires_approval ? 'pending' : 'approved', created_at: nowIso() };
    table(c.store, 'leave_requests').unshift(row); return { data: row };
  } },
  { method: 'POST', path: 'hr/leave/requests/:id/decision', handle: c => {
    need(c.actor, 'leave.manage'); const req = find(c.store, 'leave_requests', c.params.id); if (!req) throw new RuleError(404, 'Request not found');
    const decision = v.oneOf(c.payload.decision, 'Decision', ['approved', 'rejected'] as const, true)!;
    if (req.status !== 'pending') throw new RuleError(409, `This request is already ${String(req.status)}`);
    const emp = employee(c.store, String(req.employee_id)); if (emp.id === c.actor.employee_id && c.actor.role !== 'admin') throw new RuleError(403, 'You cannot decide your own leave request');
    demoAssertMonthOpen(c.store, req.counted_dates as string[]);
    if (decision === 'approved') {
      const type = find(c.store, 'leave_types', String(req.leave_type_id))!; const byYear = daysByYear(req.counted_dates as string[], Boolean(req.half_day)); const available: Record<number, number> = {};
      for (const y of Object.keys(byYear).map(Number)) { const b = balancesFor(c.store, String(emp.id), y).find(x => x.leave_type_id === type.id); available[y] = b ? Number(b.total) - Number(b.used) : 0; }
      assertSufficientBalance(byYear, available, Boolean(type.allow_negative));
    }
    Object.assign(req, { status: decision, decision_note: v.str(c.payload.note, 'Note', { max: 300 }), decided_at: nowIso() }); return { data: req };
  } },
  { method: 'POST', path: 'hr/leave/requests/:id/cancel', handle: c => {
    const req = find(c.store, 'leave_requests', c.params.id); if (!req) throw new RuleError(404, 'Request not found'); const mine = req.employee_id === c.actor.employee_id; if (!mine) need(c.actor, 'leave.manage');
    if (!['pending', 'approved'].includes(String(req.status))) throw new RuleError(409, `A ${String(req.status)} request cannot be cancelled`);
    demoAssertMonthOpen(c.store, req.counted_dates as string[]);
    if (req.status === 'approved' && mine && !can(c.actor.role, 'leave.manage') && String(req.start_date) <= today(c.store)) throw new RuleError(409, 'Approved leave that has started can only be cancelled by HR');
    req.status = 'cancelled'; return { data: req };
  } },
  { method: 'GET', path: 'hr/leave/calendar', handle: c => { need(c.actor, 'leave.manage'); const [from, to] = monthRangeOf(c.query.get('month'));
    return { data: table(c.store, 'leave_requests').filter(r => ['pending', 'approved'].includes(String(r.status)) && String(r.start_date) <= to && String(r.end_date) >= from).map(r => withNames(c.store, r)), from, to }; } },

  { method: 'GET', path: 'hr/overtime', handle: c => {
    const all = can(c.actor.role, 'overtime.manage'); const target = all ? c.query.get('employee_id') : c.actor.employee_id; const status = c.query.get('status'); const month = c.query.get('month');
    const [from, to] = month ? monthRangeOf(month) : ['', '9999-12-31'];
    return { data: table(c.store, 'overtime').filter(o => (!target || o.employee_id === target) && (!status || o.status === status) && String(o.work_date) >= from && String(o.work_date) <= to).map(o => otWithNames(c.store, o)).sort((a, b) => String(b.work_date).localeCompare(String(a.work_date))) };
  } },
  { method: 'GET', path: 'hr/overtime/eligible', handle: c => {
    const s = demoSettings(c.store);
    const data = table(c.store, 'attendance').filter(a => a.employee_id === c.actor.employee_id && Number(a.overtime_minutes) > 0 && a.punch_out && String(a.work_date) >= addDays(today(c.store), -60)
      && !table(c.store, 'overtime').some(o => o.employee_id === a.employee_id && o.work_date === a.work_date && o.status !== 'rejected')).map(a => ({ attendance_id: a.id, work_date: a.work_date, calculated_minutes: a.overtime_minutes }));
    return { data, requires_approval: s.overtime_requires_approval };
  } },
  { method: 'POST', path: 'hr/overtime', handle: c => {
    need(c.actor, 'overtime.self'); const d = c.payload; const emp = myEmployee(c); const date = v.date(d.work_date, 'Work date', true)!; const reason = v.str(d.reason, 'Reason', { required: true, max: 400 });
    demoAssertMonthOpen(c.store, date);
    const att = table(c.store, 'attendance').find(a => a.employee_id === emp.id && a.work_date === date && a.punch_out); if (!att) throw new RuleError(409, 'No completed attendance record exists for that date');
    const calculated = Number(att.overtime_minutes); const requested = validateRequestedMinutes(calculated, d.requested_minutes === undefined || d.requested_minutes === '' ? null : Number(d.requested_minutes));
    const existing = table(c.store, 'overtime').find(o => o.employee_id === emp.id && o.work_date === date); if (existing && existing.status !== 'rejected') throw new RuleError(409, 'An overtime request already exists for that date');
    const dayType = dayTypeAt(c.store, emp)(date); const values = { attendance_id: att.id, calculated_minutes: calculated, requested_minutes: requested, day_type: dayType, reason, status: 'pending', approved_minutes: null, decision_note: null, decided_at: null };
    if (existing) return { data: Object.assign(existing, values) };
    const row = { id: uid(), employee_id: emp.id, work_date: date, ...values, created_at: nowIso() }; table(c.store, 'overtime').unshift(row); return { data: row };
  } },
  { method: 'POST', path: 'hr/overtime/:id/decision', handle: c => {
    need(c.actor, 'overtime.manage'); const req = find(c.store, 'overtime', c.params.id); if (!req) throw new RuleError(404, 'Request not found');
    const decision = v.oneOf(c.payload.decision, 'Decision', ['approved', 'rejected'] as const, true)!; if (req.status !== 'pending') throw new RuleError(409, `This request is already ${String(req.status)}`);
    if (req.employee_id === c.actor.employee_id && c.actor.role !== 'admin') throw new RuleError(403, 'You cannot decide your own overtime request');
    demoAssertMonthOpen(c.store, String(req.work_date));
    const minutes = approvedMinutes(Number(req.requested_minutes), decision, c.payload.approved_minutes === undefined || c.payload.approved_minutes === '' ? null : Number(c.payload.approved_minutes));
    const s = demoSettings(c.store); const multiplier = req.day_type === 'holiday' ? s.overtime_holiday_multiplier : req.day_type === 'weekly_off' ? s.overtime_weekoff_multiplier : s.overtime_weekday_multiplier;
    return { data: Object.assign(req, { status: decision, approved_minutes: minutes, rate_multiplier: multiplier, decision_note: v.str(c.payload.note, 'Note', { max: 300 }), decided_at: nowIso() }) };
  } },
  { method: 'GET', path: 'hr/overtime/report', handle: c => { need(c.actor, 'overtime.manage'); return { data: overtimeReport(c.store, c.query.get('month')) }; } },
  { method: 'GET', path: 'hr/overtime/export', handle: c => { need(c.actor, 'overtime.manage'); const rows = overtimeReport(c.store, c.query.get('month'));
    const cell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    return { filename: `overtime-${c.query.get('month')}.csv`, csv: '\uFEFF' + [['Employee ID', 'Name', 'Department', 'Calculated Hours', 'Requested Hours', 'Approved Hours', 'Pending Requests'].map(cell).join(','),
      ...rows.map(r => [r.employee_code, r.employee_name, r.department, r.calculated_hours, r.requested_hours, r.approved_hours, r.pending_requests].map(cell).join(','))].join('\r\n') }; } },
];

function overtimeReport(store: Store, month: string | null): Row[] {
  const [from, to] = monthRangeOf(month); const h = (m: number) => Math.round(m / 60 * 100) / 100;
  return table(store, 'employees').filter(e => e.active).map(e => {
    const mine = table(store, 'overtime').filter(o => o.employee_id === e.id && String(o.work_date) >= from && String(o.work_date) <= to);
    const sum = (rows: Row[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return { employee_code: e.employee_code, employee_name: e.full_name, department: e.department,
      calculated_hours: h(sum(table(store, 'attendance').filter(a => a.employee_id === e.id && String(a.work_date) >= from && String(a.work_date) <= to), 'overtime_minutes')),
      requested_hours: h(sum(mine, 'requested_minutes')), approved_hours: h(sum(mine.filter(o => o.status === 'approved'), 'approved_minutes')), pending_requests: mine.filter(o => o.status === 'pending').length };
  });
}

function seed(store: Store) {
  const types: Array<[string, string, number, boolean, boolean]> = [['Casual Leave', 'CL', 12, true, false], ['Sick Leave', 'SL', 8, true, false], ['Earned Leave', 'EL', 15, true, false], ['Loss of Pay', 'LOP', 0, false, true]];
  for (const [name, code, quota, paid, neg] of types) table(store, 'leave_types').push({ id: uid(), name, code, annual_quota: quota, paid, count_weekends: false, count_holidays: false, allow_negative: neg, requires_approval: true, active: true });
  const sick = table(store, 'leave_types').find(t => t.code === 'SL')!; const casual = table(store, 'leave_types').find(t => t.code === 'CL')!;
  const t0 = localDate(new Date(), 'Asia/Kolkata'); const emp3 = table(store, 'employees').find(e => e.id === eid(3))!; const at = dayTypeAt(store, emp3);
  // Approved sick day for the senior recruiter (replaces that day's attendance).
  let d = addDays(t0, -9); while (at(d) !== 'working') d = addDays(d, -1);
  store.attendance = table(store, 'attendance').filter(a => !(a.employee_id === eid(3) && a.work_date === d));
  table(store, 'leave_requests').push({ id: uid(), employee_id: eid(3), leave_type_id: sick.id, start_date: d, end_date: d, half_day: false, half_day_part: null, days: 1, counted_dates: [d], reason: 'Fever', status: 'approved', created_at: nowIso() });
  // Pending casual leave for the recruiter on the evening shift.
  const emp5 = table(store, 'employees').find(e => e.id === eid(5))!; const at5 = dayTypeAt(store, emp5);
  let f = addDays(t0, 7); while (at5(f) !== 'working') f = addDays(f, 1);
  const lv = countLeave({ start: f, end: f, half_day: false, dayTypeAt: at5, rule: { count_weekends: false, count_holidays: false } });
  table(store, 'leave_requests').push({ id: uid(), employee_id: eid(5), leave_type_id: casual.id, start_date: f, end_date: f, half_day: false, half_day_part: null, days: lv.days, counted_dates: lv.dates, reason: 'Family function', status: 'pending', created_at: nowIso() });
  // Pending overtime request from the seeded 150-minute overtime day.
  const ot = table(store, 'attendance').find(a => a.employee_id === eid(3) && Number(a.overtime_minutes) > 0);
  if (ot) table(store, 'overtime').push({ id: uid(), employee_id: eid(3), attendance_id: ot.id, work_date: ot.work_date, calculated_minutes: ot.overtime_minutes, requested_minutes: ot.overtime_minutes, approved_minutes: null, day_type: 'working', reason: 'Client onboarding deadline', status: 'pending', created_at: nowIso() });
}

registerDemoModule({ name: 'leave', seed, routes });
