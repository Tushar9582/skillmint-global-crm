import test from 'node:test';
import assert from 'node:assert/strict';
import { demoHrRequest } from '../src/lib/hr/demo-all';
import { eid } from '../src/lib/hr/demo-hr';
import { countLeave, daysByYear, spansOverlap, assertSufficientBalance, leaveBalance } from '../src/lib/hr/leave';
import { approvedMinutes, hourlyRateMinor, multiplierFor, overtimePayMinor, payableOvertime, validateRequestedMinutes } from '../src/lib/hr/overtime';
import { dayTypeFor, DEFAULT_POLICY, DEFAULT_SHIFT } from '../src/lib/hr/attendance';
import { addDays } from '../src/lib/hr/time';

const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});
const as = (role: string) => mem.set('skillmint-demo-role', role);
type R = Record<string, any>;
const call = (url: string, method = 'GET', body?: unknown) => demoHrRequest<R>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

const holidays = new Set(['2026-06-10']);
const typeAt = (d: string) => dayTypeFor(d, DEFAULT_SHIFT, holidays, DEFAULT_POLICY);

test('leave days follow the weekend and holiday policy of the leave type', () => {
  const rule = { count_weekends: false, count_holidays: false };
  assert.equal(countLeave({ start: '2026-06-08', end: '2026-06-14', half_day: false, dayTypeAt: typeAt, rule }).days, 5); // Mon-Sun: Wed holiday and Sunday off, Saturday is a working day
  assert.equal(countLeave({ start: '2026-06-08', end: '2026-06-14', half_day: false, dayTypeAt: typeAt, rule: { count_weekends: true, count_holidays: true } }).days, 7);
  assert.equal(countLeave({ start: '2026-06-09', end: '2026-06-09', half_day: true, dayTypeAt: typeAt, rule }).days, 0.5);
  assert.throws(() => countLeave({ start: '2026-06-14', end: '2026-06-14', half_day: false, dayTypeAt: typeAt, rule }), /weekly offs or holidays/);
  assert.throws(() => countLeave({ start: '2026-06-09', end: '2026-06-08', half_day: false, dayTypeAt: typeAt, rule }), /End date/);
  assert.throws(() => countLeave({ start: '2026-06-08', end: '2026-06-09', half_day: true, dayTypeAt: typeAt, rule }), /single day/);
  assert.deepEqual(daysByYear(['2026-12-31', '2027-01-01', '2027-01-04'], false), { 2026: 1, 2027: 2 });
});

test('overlap and balance rules', () => {
  const a = { start_date: '2026-06-08', end_date: '2026-06-10' };
  assert.equal(spansOverlap(a, { start_date: '2026-06-10', end_date: '2026-06-12' }), true);
  assert.equal(spansOverlap(a, { start_date: '2026-06-11', end_date: '2026-06-12' }), false);
  const h1 = { start_date: '2026-06-08', end_date: '2026-06-08', half_day: true, half_day_part: 'first' };
  assert.equal(spansOverlap(h1, { ...h1, half_day_part: 'second' }), false);
  assert.equal(spansOverlap(h1, { ...h1 }), true);
  assert.equal(spansOverlap(h1, { start_date: '2026-06-08', end_date: '2026-06-08', half_day: false }), true);
  assert.deepEqual(leaveBalance({ allocated: 12, adjustment: 1, used: 3, pending: 2 }), { total: 13, used: 3, pending: 2, remaining: 8 });
  assert.throws(() => assertSufficientBalance({ 2026: 3 }, { 2026: 2 }, false), /Insufficient/);
  assert.doesNotThrow(() => assertSufficientBalance({ 2026: 3 }, { 2026: 2 }, true));
});

test('overtime calculation, approval limits and payroll eligibility', () => {
  const rates = { weekday: 1.5, weekoff: 2, holiday: 2.5 };
  assert.equal(multiplierFor('holiday', rates), 2.5);
  const hourly = hourlyRateMinor(2600000, 26, 8); // 26,000.00 basic -> 125.00/h
  assert.equal(hourly, 12500);
  assert.equal(overtimePayMinor(120, hourly, 1.5), 37500);
  assert.equal(validateRequestedMinutes(90, null), 90);
  assert.throws(() => validateRequestedMinutes(90, 120), /cannot exceed/);
  assert.throws(() => validateRequestedMinutes(0, null), /No overtime/);
  assert.equal(approvedMinutes(90, 'approved', 60), 60);
  assert.equal(approvedMinutes(90, 'rejected', 60), 0);
  assert.throws(() => approvedMinutes(90, 'approved', 100), /between/);
  const rows = [{ calculated: 100, approved: 60, status: 'approved' }, { calculated: 50, approved: null, status: 'pending' }, { calculated: 30, approved: 0, status: 'rejected' }];
  assert.equal(payableOvertime(rows, true), 60);
  assert.equal(payableOvertime(rows, false), 180);
});

const nextYear = new Date().getFullYear() + 1;
const monday = (() => { let d = `${nextYear}-06-07`; while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return d; })();

test('demo leave workflow: apply, overlap, balance, approval and calendar cover', async () => {
  as('hr_manager');
  const wed = addDays(monday, 2);
  await call('/api/v1/hr/holidays', 'POST', { name: 'Test Holiday', holiday_date: wed, holiday_type: 'public' });
  as('employee');
  const types = (await call('/api/v1/hr/leave/types')).data;
  const cl = types.find((t: R) => t.code === 'CL'); const sl = types.find((t: R) => t.code === 'SL');
  const first = await call('/api/v1/hr/leave/requests', 'POST', { leave_type_id: cl.id, start_date: monday, end_date: addDays(monday, 4), reason: 'Trip' });
  assert.equal(first.data.days, 4, 'Mon-Fri minus the Wednesday holiday');
  await fails(call('/api/v1/hr/leave/requests', 'POST', { leave_type_id: sl.id, start_date: addDays(monday, 3), end_date: addDays(monday, 3), half_day: true, reason: 'x' }), /overlaps/);
  await fails(call('/api/v1/hr/leave/requests', 'POST', { leave_type_id: cl.id, start_date: addDays(monday, 7), end_date: addDays(monday, 18), reason: 'Long' }), /Insufficient leave balance/);
  const bal = (await call(`/api/v1/hr/leave/balances?year=${nextYear}`)).data.find((b: R) => b.code === 'CL');
  assert.equal(bal.pending, 4); assert.equal(bal.remaining, 8);
  await fails(call(`/api/v1/hr/leave/requests/${first.data.id}/decision`, 'POST', { decision: 'approved' }), /permission/);
  as('hr_manager');
  await call(`/api/v1/hr/leave/requests/${first.data.id}/decision`, 'POST', { decision: 'approved', note: 'Enjoy' });
  await fails(call(`/api/v1/hr/leave/requests/${first.data.id}/decision`, 'POST', { decision: 'rejected' }), /already approved/);
  const month = monday.slice(0, 7);
  const cal = await call(`/api/v1/hr/attendance/calendar?month=${month}&employee_id=${eid(3)}`);
  const statusOf = (d: string) => cal.data.find((x: R) => x.date === d).status;
  assert.equal(statusOf(monday), 'leave'); assert.equal(statusOf(wed), 'holiday');
  assert.equal((await call(`/api/v1/hr/leave/calendar?month=${month}`)).data.length >= 1, true);
  as('employee');
  const after = (await call(`/api/v1/hr/leave/balances?year=${nextYear}`)).data.find((b: R) => b.code === 'CL');
  assert.equal(after.used, 4);
  await call(`/api/v1/hr/leave/requests/${first.data.id}/cancel`, 'POST');
  assert.equal((await call(`/api/v1/hr/leave/balances?year=${nextYear}`)).data.find((b: R) => b.code === 'CL').used, 0);
});

test('nobody approves their own leave or overtime (except admin) and balances are manager-only', async () => {
  as('hr_manager');
  const cl = (await call('/api/v1/hr/leave/types')).data.find((t: R) => t.code === 'CL');
  const mine = await call('/api/v1/hr/leave/requests', 'POST', { leave_type_id: cl.id, start_date: addDays(monday, 14), reason: 'Personal' });
  await fails(call(`/api/v1/hr/leave/requests/${mine.data.id}/decision`, 'POST', { decision: 'approved' }), /own leave/);
  as('admin'); await call(`/api/v1/hr/leave/requests/${mine.data.id}/decision`, 'POST', { decision: 'approved' });
  as('employee');
  await fails(call(`/api/v1/hr/leave/balances?employee_id=${eid(2)}`), /permission/);
  await fails(call('/api/v1/hr/leave/types', 'POST', { name: 'X', code: 'X' }), /permission/);
  as('hr_manager');
  await call('/api/v1/hr/leave/balances', 'POST', { employee_id: eid(3), leave_type_id: cl.id, year: nextYear, adjustment: 2, reason: 'Carry forward' });
  as('employee');
  assert.equal((await call(`/api/v1/hr/leave/balances?year=${nextYear}`)).data.find((b: R) => b.code === 'CL').total, 14);
});

test('demo overtime workflow honours request limits and approval roles', async () => {
  as('hr_manager');
  const pending = (await call('/api/v1/hr/overtime?status=pending')).data;
  assert.ok(pending.length >= 1);
  const row = pending[0];
  await fails(call(`/api/v1/hr/overtime/${row.id}/decision`, 'POST', { decision: 'approved', approved_minutes: row.requested_minutes + 1 }), /between/);
  as('employee');
  await fails(call(`/api/v1/hr/overtime/${row.id}/decision`, 'POST', { decision: 'approved' }), /permission/);
  await fails(call('/api/v1/hr/overtime', 'POST', { work_date: addDays(monday, 30), reason: 'x' }), /No completed attendance/);
  as('hr_manager');
  const done = await call(`/api/v1/hr/overtime/${row.id}/decision`, 'POST', { decision: 'approved', approved_minutes: 60, note: 'ok' });
  assert.equal(done.data.approved_minutes, 60); assert.equal(done.data.rate_multiplier, 1.5);
  const report = (await call(`/api/v1/hr/overtime/report?month=${String(row.work_date).slice(0, 7)}`)).data.find((r: R) => r.employee_code === 'EMP-0003');
  assert.equal(report.approved_hours, 1);
  await call('/api/v1/hr/settings', 'PATCH', { overtime_weekday_multiplier: 1.75 });
  as('finance');
  await fails(call('/api/v1/hr/settings', 'PATCH', { overtime_weekday_multiplier: 3 }), /permission/);
});

test('shift assignment keeps history, groups by department and rejects bad input', async () => {
  as('employee');
  await fails(call('/api/v1/hr/shifts'), /permission/);
  as('hr_manager');
  const shifts = (await call('/api/v1/hr/shifts')).data;
  const morning = shifts.find((s: R) => s.kind === 'morning'); const night = shifts.find((s: R) => s.kind === 'night');
  const from = addDays(new Date().toISOString().slice(0, 10), 2);
  const result = await call('/api/v1/hr/shifts/assign', 'POST', { shift_id: morning.id, department: 'Recruitment', effective_from: from, reason: 'Client hours' });
  assert.equal(result.data.assigned, 2);
  const again = await call('/api/v1/hr/shifts/assign', 'POST', { shift_id: morning.id, department: 'Recruitment', effective_from: addDays(from, 1) });
  assert.equal(again.data.assigned, 0);
  const history = (await call(`/api/v1/hr/shifts/history?employee_id=${eid(3)}`)).data;
  assert.equal(history.length, 2); assert.equal(history[1].effective_to, addDays(from, -1));
  await fails(call('/api/v1/hr/shifts', 'POST', { name: 'Bad', start_time: '09:00', end_time: '09:00' }), /cannot be the same/);
  await fails(call('/api/v1/hr/shifts', 'POST', { name: 'Bad2', start_time: '09:00', end_time: '17:00', weekly_off: [0], working_days: [0, 1] }), /both/);
  await fails(call(`/api/v1/hr/shifts/${night.id}`, 'PATCH', { active: false }), /Reassign employees/);
  await fails(call('/api/v1/hr/settings', 'PATCH', { half_day_ratio: 0.9, full_day_ratio: 0.8 }), /lower/);
  await fails(call('/api/v1/hr/settings', 'PATCH', { timezone: 'Mars/Base' }), /time zone/);
});
