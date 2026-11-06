'use client';

import { RuleError, can, assertDate } from './core';
import { addDays, eachDate, localDate, monthRange, zonedTime } from './time';
import {
  DEFAULT_POLICY, DEFAULT_SHIFT, dayStatus, dayTypeFor, evaluateDay, holidayApplies, planPunch, scheduledMinutes,
  type AttRow, type Policy, type ShiftDef,
} from './attendance';
import { v, has } from './validate';
import { DEMO_PEOPLE, eid, need, nowIso, registerDemoModule, table, uid, type DemoCtx, type DemoRoute, type Row, type Store } from './demo-hr';

export const demoSettings = (store: Store): Policy & Row => {
  const meta = table(store, 'settings');
  if (!meta.length) meta.push({ ...DEFAULT_POLICY, overtime_requires_approval: true, overtime_weekday_multiplier: 1.5, overtime_weekoff_multiplier: 2, overtime_holiday_multiplier: 2 });
  return meta[0] as Policy & Row;
};
const tzOf = (store: Store) => demoSettings(store).timezone;

/** Mirrors the server rule: finalized payroll locks attendance, leave, overtime and holiday changes for that month. */
export function demoAssertMonthOpen(store: Store, dates: string | string[]) {
  for (const m of new Set((Array.isArray(dates) ? dates : [dates]).map(d => d.slice(0, 7))))
    if (table(store, 'pay_runs').some(r => r.status === 'finalized' && r.period_year === Number(m.slice(0, 4)) && r.period_month === Number(m.slice(5, 7)))) throw new RuleError(409, `Payroll for ${m} is finalized; this change is locked`);
}

export const demoLeaveHooks: { cover: (store: Store, employeeId: string, from: string, to: string) => Map<string, { half_day: boolean; paid: boolean }> } = {
  cover: () => new Map(),
};

export function demoShiftAt(store: Store, employeeId: string, date: string): ShiftDef | null {
  const shifts = table(store, 'shifts');
  const a = table(store, 'shift_assignments').filter(x => x.employee_id === employeeId && String(x.effective_from) <= date && (!x.effective_to || String(x.effective_to) >= date))
    .sort((p, q) => String(q.effective_from).localeCompare(String(p.effective_from)) || String(q.created_at).localeCompare(String(p.created_at)))[0];
  return (a ? shifts.find(s => s.id === a.shift_id) : null) as ShiftDef | null ?? null;
}
export function demoHolidayDates(store: Store, emp: Row, from: string, to: string): Set<string> {
  return new Set(table(store, 'holidays').filter(h => String(h.holiday_date) >= from && String(h.holiday_date) <= to && h.holiday_type !== 'optional'
    && holidayApplies(h as never, { location: emp.location as string, department: emp.department as string })).map(h => String(h.holiday_date)));
}

export function demoMonthDays(store: Store, emp: Row, from: string, to: string) {
  const settings = demoSettings(store); const tz = settings.timezone; const today = localDate(new Date(), tz);
  const holidays = demoHolidayDates(store, emp, from, to);
  const leave = demoLeaveHooks.cover(store, String(emp.id), from, to);
  const records = table(store, 'attendance').filter(r => r.employee_id === emp.id);
  return eachDate(from, to).map(date => {
    const shift = demoShiftAt(store, String(emp.id), date) ?? DEFAULT_SHIFT;
    const dayType = dayTypeFor(date, shift, holidays, settings);
    const record = (records.find(r => r.work_date === date) ?? null) as Row | null;
    return { date, day_type: dayType, leave: leave.get(date) ?? null, record,
      status: dayStatus({ date, today, joining: emp.joining_date as string, exit: emp.exit_date as string, dayType, leave: leave.get(date) ?? null, record: record as never }) };
  });
}

const employeeView = (store: Store, e: Row): Row => ({
  ...e, manager_name: table(store, 'employees').find(m => m.id === e.manager_id)?.full_name ?? null,
});
function findEmployee(store: Store, id: string): Row {
  const e = table(store, 'employees').find(x => x.id === id);
  if (!e) throw new RuleError(404, 'Employee not found');
  return e;
}
export const myEmployee = (c: DemoCtx): Row => findEmployee(c.store, c.actor.employee_id);

const STATUSES = ['probation', 'active', 'notice', 'resigned', 'terminated', 'inactive'] as const;
function parseEmployee(data: Row, create: boolean): Row {
  const out: Row = {};
  const set = (key: string, value: unknown) => { if (create || has(data, key)) out[key] = value; };
  if (create || has(data, 'full_name')) out.full_name = v.str(data.full_name, 'Full name', { required: true, max: 150 });
  if (create || has(data, 'email')) out.email = v.email(data.email);
  set('phone', v.phone(data.phone)); set('department', v.str(data.department, 'Department', { max: 100 }));
  set('designation', v.str(data.designation, 'Designation', { max: 100 })); set('location', v.str(data.location, 'Location', { max: 100 }));
  if (create || has(data, 'joining_date')) out.joining_date = v.date(data.joining_date, 'Joining date', create);
  if (create || has(data, 'employment_status')) out.employment_status = v.oneOf(data.employment_status ?? 'active', 'Employment status', STATUSES, true);
  if (has(data, 'manager_id')) out.manager_id = v.uuid(data.manager_id, 'Reporting manager');
  set('date_of_birth', v.date(data.date_of_birth, 'Date of birth')); set('gender', v.oneOf(data.gender, 'Gender', ['female', 'male', 'other']));
  set('marital_status', v.oneOf(data.marital_status, 'Marital status', ['single', 'married', 'other']));
  set('address', v.str(data.address, 'Address', { max: 600 }));
  set('emergency_contact_name', v.str(data.emergency_contact_name, 'Emergency contact', { max: 150 }));
  set('emergency_contact_relation', v.str(data.emergency_contact_relation, 'Relation', { max: 80 }));
  set('emergency_contact_phone', v.phone(data.emergency_contact_phone, 'Emergency phone'));
  if (has(data, 'personal')) out.personal = data.personal && typeof data.personal === 'object' ? data.personal : {};
  return out;
}

function applyEdit(c: DemoCtx, employee: Row, workDate: string, data: Row, existing: Row | null) {
  const settings = demoSettings(c.store); const tz = settings.timezone;
  demoAssertMonthOpen(c.store, workDate);
  const inTime = data.in_time ? v.time(data.in_time, 'Punch-in time') : null;
  const outTime = data.out_time ? v.time(data.out_time, 'Punch-out time') : null;
  if (!inTime) throw new RuleError(400, 'Punch-in time is required');
  const reason = v.str(data.reason, 'Correction reason', { required: true, max: 500 });
  const shift = demoShiftAt(c.store, String(employee.id), workDate) ?? DEFAULT_SHIFT;
  const punchIn = zonedTime(workDate, inTime, tz);
  let punchOut: Date | null = null;
  if (outTime) { punchOut = zonedTime(workDate, outTime, tz); if (punchOut <= punchIn) punchOut = zonedTime(addDays(workDate, 1), outTime, tz); }
  const ev = evaluateDay(shift, settings, workDate, punchIn, punchOut, new Date(), dayTypeFor(workDate, shift, demoHolidayDates(c.store, employee, workDate, workDate), settings));
  const values = { punch_in: punchIn.toISOString(), punch_out: punchOut?.toISOString() ?? null, ...ev };
  const old = existing ? { punch_in: existing.punch_in, punch_out: existing.punch_out, status: existing.status, worked_minutes: existing.worked_minutes } : {};
  let saved: Row;
  if (existing) { Object.assign(existing, values, { source: 'correction', notes: reason, updated_at: nowIso() }); saved = existing; }
  else { saved = { id: uid(), employee_id: employee.id, work_date: workDate, shift_id: (shift as unknown as Row).id ?? null, ...values, source: 'correction', notes: reason, created_at: nowIso() }; table(c.store, 'attendance').push(saved); }
  table(c.store, 'corrections').unshift({ id: uid(), attendance_id: saved.id, employee_id: employee.id, old_values: old, new_values: values, reason, corrected_by_name: c.actor.full_name, created_at: nowIso() });
  return saved;
}

function csv(headers: string[], rows: unknown[][]): string {
  const cell = (x: unknown) => { let t = x == null ? '' : String(x); if (/^[=+@\-\t\r]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  return '\uFEFF' + [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n');
}

function saveHoliday(c: DemoCtx, id: string | null): Row {
  const d = c.payload; const holidays = table(c.store, 'holidays');
  const values: Row = {};
  if (!id || has(d, 'name')) values.name = v.str(d.name, 'Holiday name', { required: true, max: 150 });
  if (!id || has(d, 'holiday_date')) values.holiday_date = v.date(d.holiday_date, 'Holiday date', true);
  if (!id || has(d, 'holiday_type')) values.holiday_type = v.oneOf(d.holiday_type ?? 'public', 'Holiday type', ['public', 'company', 'optional', 'regional'] as const, true);
  if (!id || has(d, 'locations')) values.locations = v.list(d.locations, 'Locations');
  if (!id || has(d, 'teams')) values.teams = v.list(d.teams, 'Teams');
  if (!id || has(d, 'notes')) values.notes = v.str(d.notes, 'Notes', { max: 500 });
  const merged = { ...(id ? holidays.find(h => h.id === id) : {}), ...values };
  demoAssertMonthOpen(c.store, String(merged.holiday_date));
  if (holidays.some(h => h.id !== id && h.holiday_date === merged.holiday_date && h.name === merged.name)) throw new RuleError(409, 'A holiday with this name already exists on that date');
  if (!id) { const row = { id: uid(), ...values, created_at: nowIso() }; holidays.push(row); return row; }
  const row = holidays.find(h => h.id === id); if (!row) throw new RuleError(404, 'Holiday not found');
  return Object.assign(row, values);
}

const routes: DemoRoute[] = [
  { method: 'GET', path: 'hr/me', handle: c => ({ data: { employee: myEmployee(c), permissions: { view_all: can(c.actor.role, 'attendance.view_all') } } }) },

  { method: 'GET', path: 'hr/employees', handle: c => {
    need(c.actor, 'employees.view');
    const q = c.query.get('q')?.toLowerCase().trim(); const dep = c.query.get('department'); const status = c.query.get('status'); const active = c.query.get('active');
    const all = table(c.store, 'employees');
    const data = all.filter(e => (!q || [e.full_name, e.email, e.employee_code, e.phone].some(x => String(x ?? '').toLowerCase().includes(q)))
      && (!dep || e.department === dep) && (!status || e.employment_status === status) && (active !== 'true' && active !== 'false' || e.active === (active === 'true')))
      .sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code))).map(e => employeeView(c.store, e));
    return { data, departments: [...new Set(all.map(e => e.department).filter(Boolean))].sort() };
  } },
  { method: 'POST', path: 'hr/employees', handle: c => {
    need(c.actor, 'employees.manage');
    const values = parseEmployee(c.payload, true); const all = table(c.store, 'employees');
    if (values.email && all.some(e => e.active && String(e.email ?? '').toLowerCase() === values.email)) throw new RuleError(409, 'An active employee with this email already exists');
    if (v.bool(c.payload.create_login) && c.actor.role !== 'admin') throw new RuleError(403, 'Only an Administrator can create login accounts');
    if (values.manager_id) findEmployee(c.store, String(values.manager_id));
    const n = Math.max(0, ...all.map(e => Number(String(e.employee_code).slice(4)) || 0)) + 1;
    const row: Row = { id: uid(), user_id: null, employee_code: `EMP-${String(n).padStart(4, '0')}`, ...values, active: true, personal: values.personal ?? {}, created_at: nowIso() };
    all.push(row);
    table(c.store, 'history').unshift({ id: uid(), employee_id: row.id, event_type: 'joined', details: { department: row.department, designation: row.designation }, effective_date: row.joining_date, created_at: nowIso() });
    return { data: row };
  } },
  { method: 'GET', path: 'hr/employees/:id', handle: c => {
    const e = findEmployee(c.store, c.params.id);
    if (e.id !== c.actor.employee_id) need(c.actor, 'employees.view');
    const today = localDate(new Date(), tzOf(c.store));
    const shift = demoShiftAt(c.store, c.params.id, today);
    return { data: { employee: employeeView(c.store, e), history: table(c.store, 'history').filter(h => h.employee_id === e.id),
      documents: table(c.store, 'documents').filter(d => d.employee_id === e.id && !d.archived_at), shift } };
  } },
  { method: 'PATCH', path: 'hr/employees/:id', handle: c => {
    need(c.actor, 'employees.manage');
    const e = findEmployee(c.store, c.params.id); const values = parseEmployee(c.payload, false);
    if (values.manager_id) {
      for (let m: Row | undefined = findEmployee(c.store, String(values.manager_id)), guard = 0; m && guard < 50; guard++, m = table(c.store, 'employees').find(x => x.id === m!.manager_id))
        if (m.id === e.id) throw new RuleError(400, 'This reporting line would create a loop');
    }
    if (values.employment_status) {
      const off = ['resigned', 'terminated', 'inactive'].includes(String(values.employment_status));
      if (off && e.id === c.actor.employee_id) throw new RuleError(400, 'You cannot deactivate your own account');
      values.active = !off; values.exit_date = off ? (e.exit_date || localDate(new Date(), tzOf(c.store))) : null;
    }
    for (const key of ['department', 'designation', 'location', 'manager_id', 'employment_status'])
      if (has(values, key) && String(values[key] ?? '') !== String(e[key] ?? ''))
        table(c.store, 'history').unshift({ id: uid(), employee_id: e.id, event_type: `${key}_change`, details: { from: e[key] ?? null, to: values[key] ?? null }, created_at: nowIso() });
    return { data: Object.assign(e, values, { updated_at: nowIso() }) };
  } },
  { method: 'POST', path: 'hr/employees/:id/documents', handle: c => {
    need(c.actor, 'documents.manage'); findEmployee(c.store, c.params.id);
    const file = c.form?.get('file');
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !/\.(pdf|png|jpe?g)$/i.test(file.name)) throw new RuleError(400, 'Only valid PDF, PNG or JPG files up to 5 MB are accepted');
    const row = { id: uid(), employee_id: c.params.id, doc_type: String(c.form?.get('doc_type') || 'other'), title: String(c.form?.get('title') || file.name), original_filename: file.name, file_size: file.size, created_at: nowIso() };
    table(c.store, 'documents').unshift(row); return { data: row };
  } },
  { method: 'DELETE', path: 'hr/employees/:id/documents/:docId', handle: c => {
    need(c.actor, 'documents.manage');
    const d = table(c.store, 'documents').find(x => x.id === c.params.docId); if (!d) throw new RuleError(404, 'Document not found');
    d.archived_at = nowIso(); return { ok: true };
  } },

  { method: 'GET', path: 'hr/holidays', handle: c => {
    const year = Number(c.query.get('year') || new Date().getFullYear());
    return { data: table(c.store, 'holidays').filter(h => String(h.holiday_date).startsWith(String(year))).sort((a, b) => String(a.holiday_date).localeCompare(String(b.holiday_date))) };
  } },
  { method: 'POST', path: 'hr/holidays', handle: c => { need(c.actor, 'holidays.manage'); return { data: saveHoliday(c, null) }; } },
  { method: 'PATCH', path: 'hr/holidays/:id', handle: c => { need(c.actor, 'holidays.manage'); return { data: saveHoliday(c, c.params.id) }; } },
  { method: 'DELETE', path: 'hr/holidays/:id', handle: c => {
    need(c.actor, 'holidays.manage'); const h = table(c.store, 'holidays'); const i = h.findIndex(x => x.id === c.params.id);
    if (i < 0) throw new RuleError(404, 'Holiday not found'); demoAssertMonthOpen(c.store, String(h[i].holiday_date)); h.splice(i, 1); return { ok: true };
  } },

  { method: 'GET', path: 'hr/attendance/me', handle: c => {
    const emp = myEmployee(c); const settings = demoSettings(c.store); const now = new Date(); const today = localDate(now, settings.timezone);
    const shift = demoShiftAt(c.store, String(emp.id), today) ?? DEFAULT_SHIFT;
    const mine = table(c.store, 'attendance').filter(r => r.employee_id === emp.id);
    const open = mine.filter(r => r.punch_in && !r.punch_out).sort((a, b) => String(b.punch_in).localeCompare(String(a.punch_in)))[0];
    const record = open && now.getTime() - new Date(String(open.punch_in)).getTime() < settings.max_open_hours * 3600000 ? open : mine.find(r => r.work_date === today) ?? null;
    const live = record && !record.punch_out ? { ...record, worked_minutes: Math.max(0, Math.round((now.getTime() - new Date(String(record.punch_in)).getTime()) / 60000)) } : record;
    return { data: { employee: emp, today, server_time: now.toISOString(), timezone: settings.timezone, record: live,
      shift: { ...shift, scheduled_minutes: scheduledMinutes(shift, settings.timezone) }, punched_in: Boolean(live && !live.punch_out) } };
  } },
  { method: 'POST', path: 'hr/attendance/punch', handle: c => {
    need(c.actor, 'attendance.self');
    const action = v.oneOf(c.payload.action, 'Action', ['in', 'out'] as const, true)!;
    const emp = myEmployee(c); if (!emp.active) throw new RuleError(403, 'Your employee record is inactive');
    const settings = demoSettings(c.store); const now = new Date(); const today = localDate(now, settings.timezone);
    const mine = table(c.store, 'attendance').filter(r => r.employee_id === emp.id) as unknown as Array<AttRow & Row>;
    const open = mine.filter(r => r.punch_in && !r.punch_out).sort((a, b) => String(b.punch_in).localeCompare(String(a.punch_in)))[0] ?? null;
    const plan = planPunch({ action, now, policy: settings, shift: demoShiftAt(c.store, String(emp.id), today), holidayDates: demoHolidayDates(c.store, emp, addDays(today, -1), addDays(today, 1)),
      open, existingForDate: d => mine.find(r => r.work_date === d) ?? null });
    if (plan.flagOpen) { const o = mine.find(r => r.id === plan.flagOpen); if (o) o.status = 'missing_punch'; }
    if (plan.insert) { const row = { id: uid(), employee_id: emp.id, ...plan.insert, source: 'self', created_at: nowIso() }; table(c.store, 'attendance').push(row); return { data: row, message: 'Punched in' }; }
    const target = mine.find(r => r.id === plan.update!.id)!; Object.assign(target, plan.update!.changes, { updated_at: nowIso() });
    return { data: target, message: 'Punched out' };
  } },
  { method: 'GET', path: 'hr/attendance', handle: c => {
    const all = can(c.actor.role, 'attendance.view_all'); const target = all ? c.query.get('employee_id') : c.actor.employee_id;
    const from = c.query.get('from'); const to = c.query.get('to'); const status = c.query.get('status'); const issue = c.query.get('issue'); const dep = c.query.get('department');
    if (from) assertDate(from, 'From date'); if (to) assertDate(to, 'To date');
    const emps = table(c.store, 'employees');
    const data = table(c.store, 'attendance').filter(r => (!target || r.employee_id === target) && (!from || String(r.work_date) >= from) && (!to || String(r.work_date) <= to)
      && (!status || r.status === status) && (issue !== 'late' || Number(r.late_minutes) > 0) && (issue !== 'early' || Number(r.early_minutes) > 0) && (issue !== 'missing' || r.status === 'missing_punch')
      && (!all || !dep || emps.find(e => e.id === r.employee_id)?.department === dep))
      .map((r): Row => { const e = emps.find(x => x.id === r.employee_id); return { ...r, employee_name: e?.full_name, employee_code: e?.employee_code, department: e?.department }; })
      .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)) || String(a.employee_name).localeCompare(String(b.employee_name))).slice(0, 1000);
    return { data, timezone: tzOf(c.store) };
  } },
  { method: 'GET', path: 'hr/attendance/today', handle: c => {
    need(c.actor, 'attendance.view_all'); const tz = tzOf(c.store); const today = localDate(new Date(), tz);
    const rows = table(c.store, 'employees').filter(e => e.active).map(e => ({ employee_id: e.id, employee_name: e.full_name, employee_code: e.employee_code, department: e.department, ...demoMonthDays(c.store, e, today, today)[0] }));
    const count = (s: string) => rows.filter(r => r.status === s).length;
    return { data: rows, summary: { total: rows.length, present: rows.filter(r => ['present', 'in_progress', 'half_day'].includes(r.status)).length,
      absent: count('not_punched') + count('absent'), on_leave: count('leave') + count('half_day_leave'), missing_punch: count('missing_punch') }, date: today };
  } },
  { method: 'GET', path: 'hr/attendance/calendar', handle: c => {
    const id = c.query.get('employee_id') || c.actor.employee_id;
    if (id !== c.actor.employee_id) need(c.actor, 'attendance.view_all');
    const emp = findEmployee(c.store, id); const m = String(c.query.get('month') || '').match(/^(\d{4})-(\d{2})$/);
    const [year, mon] = m ? [Number(m[1]), Number(m[2])] : localDate(new Date(), tzOf(c.store)).split('-').slice(0, 2).map(Number);
    const [from, to] = monthRange(year, mon);
    return { data: demoMonthDays(c.store, emp, from, to), employee: { id: emp.id, full_name: emp.full_name, employee_code: emp.employee_code }, month: `${year}-${String(mon).padStart(2, '0')}` };
  } },
  { method: 'GET', path: 'hr/attendance/export', handle: c => {
    need(c.actor, 'attendance.view_all'); const m = String(c.query.get('month') || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new RuleError(400, 'Month must be YYYY-MM');
    const [from, to] = monthRange(Number(m[1]), Number(m[2])); const tz = tzOf(c.store);
    const time = (x: unknown) => x ? new Date(String(x)).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '';
    const rows: unknown[][] = [];
    for (const e of table(c.store, 'employees')) for (const d of demoMonthDays(c.store, e, from, to)) {
      if (d.status === 'not_joined' || d.status === 'inactive') continue; const r = d.record;
      rows.push([e.employee_code, e.full_name, e.department, d.date, d.status, time(r?.punch_in), time(r?.punch_out), r ? (Number(r.worked_minutes) / 60).toFixed(2) : '', r?.late_minutes ?? '', r?.early_minutes ?? '', r ? (Number(r.overtime_minutes) / 60).toFixed(2) : '']);
    }
    return { filename: `attendance-${m[1]}-${m[2]}.csv`, csv: csv(['Employee ID', 'Name', 'Department', 'Date', 'Status', 'In', 'Out', 'Worked Hours', 'Late Minutes', 'Early Leaving Minutes', 'Overtime Hours'], rows) };
  } },
  { method: 'PATCH', path: 'hr/attendance/:id', handle: c => {
    need(c.actor, 'attendance.correct'); const rec = table(c.store, 'attendance').find(r => r.id === c.params.id); if (!rec) throw new RuleError(404, 'Attendance record not found');
    return { data: applyEdit(c, findEmployee(c.store, String(rec.employee_id)), String(rec.work_date), c.payload, rec) };
  } },
  { method: 'POST', path: 'hr/attendance/manual', handle: c => {
    need(c.actor, 'attendance.correct'); const emp = findEmployee(c.store, String(v.uuid(c.payload.employee_id, 'Employee', true))); const date = v.date(c.payload.work_date, 'Work date', true)!;
    return { data: applyEdit(c, emp, date, c.payload, table(c.store, 'attendance').find(r => r.employee_id === emp.id && r.work_date === date) ?? null) };
  } },
  { method: 'GET', path: 'hr/attendance/:id/corrections', handle: c => { need(c.actor, 'attendance.view_all'); return { data: table(c.store, 'corrections').filter(x => x.attendance_id === c.params.id) }; } },
];

function seed(store: Store) {
  const year = new Date().getFullYear(); const tz = 'Asia/Kolkata'; const now = new Date(); const today = localDate(now, tz);
  const people: Array<[number, string, string, string, string, string, string, number | null]> = [
    [1, 'SkillMint Development Admin', 'Management', 'Director', 'Bengaluru', '2024-04-01', 'general', null],
    [2, 'Hema Rao', 'Human Resources', 'HR Manager', 'Bengaluru', '2024-06-10', 'general', 1],
    [3, 'Aarav Sharma', 'Recruitment', 'Senior Recruiter', 'Bengaluru', '2025-01-06', 'general', 1],
    [4, 'Farah Khan', 'Finance', 'Payroll Executive', 'Mumbai', '2025-02-17', 'general', 1],
    [5, 'Rohan Verma', 'Recruitment', 'Recruiter', 'Pune', '2025-08-04', 'evening', 3],
    [6, 'Meera Iyer', 'Operations', 'Support Associate', 'Bengaluru', '2025-09-15', 'night', 2],
  ];
  const roleOf: Record<number, keyof typeof DEMO_PEOPLE> = { 1: 'admin', 2: 'hr_manager', 3: 'employee', 4: 'finance' };
  const employees = table(store, 'employees');
  for (const [n, name, dept, des, loc, join, , mgr] of people) {
    const role = roleOf[n];
    employees.push({ id: eid(n), user_id: role ? DEMO_PEOPLE[role].id : null, employee_code: `EMP-${String(n).padStart(4, '0')}`, full_name: name,
      email: role ? DEMO_PEOPLE[role].email : `${name.split(' ')[0].toLowerCase()}@skillmint.local`, phone: `98765${String(40000 + n * 111)}`, department: dept, designation: des, location: loc,
      joining_date: join, employment_status: 'active', manager_id: mgr ? eid(mgr) : null, active: true, gender: null, personal: {},
      emergency_contact_name: n === 3 ? 'Neha Sharma' : null, emergency_contact_relation: n === 3 ? 'Spouse' : null, emergency_contact_phone: n === 3 ? '9876500001' : null,
      login_role: role ?? null, created_at: nowIso() });
    table(store, 'history').push({ id: uid(), employee_id: eid(n), event_type: 'joined', details: { department: dept, designation: des }, effective_date: join, created_at: nowIso() });
  }
  const shiftDefs: Array<[string, string, string, string, number, number, number[]]> = [
    ['general', 'General Shift', 'custom', '09:30-18:30', 60, 15, [0]], ['morning', 'Morning Shift', 'morning', '06:00-14:30', 30, 10, [0]],
    ['evening', 'Evening Shift', 'evening', '14:00-22:30', 30, 10, [0]], ['night', 'Night Shift', 'night', '22:00-06:00', 30, 10, [0]],
  ];
  const shiftIds: Record<string, string> = {};
  for (const [key, name, kind, span, brk, grace, off] of shiftDefs) {
    const [s, e] = span.split('-'); shiftIds[key] = uid();
    table(store, 'shifts').push({ id: shiftIds[key], name, kind, start_time: s, end_time: e, break_minutes: brk, grace_minutes: grace, weekly_off: off, working_days: [1, 2, 3, 4, 5, 6], active: true, created_at: nowIso() });
  }
  for (const [n, , , , , join, key] of people) table(store, 'shift_assignments').push({ id: uid(), employee_id: eid(n), shift_id: shiftIds[key], effective_from: join, effective_to: null, reason: 'Initial assignment', created_at: nowIso() });
  const holidays: Array<[string, string, string]> = [[`${year}-01-26`, 'Republic Day', 'public'], [`${year}-08-15`, 'Independence Day', 'public'], [`${year}-10-02`, 'Gandhi Jayanti', 'public'],
    [`${year}-12-25`, 'Christmas', 'public'], [`${year}-11-01`, 'Kannada Rajyotsava', 'regional'], [`${year}-03-04`, 'Company Foundation Day', 'company']];
  for (const [date, name, type] of holidays) table(store, 'holidays').push({ id: uid(), name, holiday_date: date, holiday_type: type, locations: name === 'Kannada Rajyotsava' ? ['Bengaluru'] : [], teams: [], notes: null, created_at: nowIso() });
  const policy: Policy = { ...DEFAULT_POLICY, timezone: tz };
  const prevStart = (() => { const [yy, mm] = today.split('-').map(Number); return new Date(Date.UTC(yy, mm - 3, 1)).toISOString().slice(0, 10); })();
  for (const [n, , , , loc, join, key] of people) {
    const shift = table(store, 'shifts').find(s => s.id === shiftIds[key]) as unknown as ShiftDef;
    const emp = { id: eid(n), location: loc, department: '' };
    const holidaySet = demoHolidayDates(store, emp, addDays(today, -40), today);
    for (let back = 1; ; back++) {
      const date = addDays(today, -back); if (date < join || date < prevStart) break;
      const type = dayTypeFor(date, shift, holidaySet, policy);
      if (type !== 'working') continue;
      const inOff = ((n * 5 + back * 3) % 22) - 6; const outOff = ((n * 3 + back * 7) % 35) - 12;
      const win = { start: zonedTime(date, shift.start_time, tz), end: zonedTime(date, shift.end_time, tz) }; if (win.end <= win.start) win.end = zonedTime(addDays(date, 1), shift.end_time, tz);
      const punchIn = new Date(win.start.getTime() + inOff * 60000);
      const missing = n === 3 && back === 6;
      const extra = n === 3 && back === 3 ? 150 : 0; // seeded overtime sample
      const punchOut = missing ? null : new Date(win.end.getTime() + (outOff + extra) * 60000);
      const ev = evaluateDay(shift, policy, date, punchIn, punchOut, now, type);
      table(store, 'attendance').push({ id: uid(), employee_id: eid(n), work_date: date, shift_id: shiftIds[key], punch_in: punchIn.toISOString(), punch_out: punchOut?.toISOString() ?? null, ...ev, source: 'self', created_at: nowIso() });
    }
  }
}

registerDemoModule({ name: 'core', seed, routes });
export { demoSettings as settingsOf };
