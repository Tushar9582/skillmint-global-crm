import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedTime, localDate, addDays, monthRange } from '../src/lib/hr/time';
import { DEFAULT_POLICY, DEFAULT_SHIFT, attributeWorkDate, dayStatus, dayTypeFor, evaluateDay, holidayApplies, planPunch, scheduledMinutes, shiftWindow, type AttRow, type ShiftDef } from '../src/lib/hr/attendance';
import { RuleError, can } from '../src/lib/hr/core';

const tz = 'Asia/Kolkata';
const policy = { ...DEFAULT_POLICY, timezone: tz };
const day: ShiftDef = { start_time: '09:30', end_time: '18:30', break_minutes: 60, grace_minutes: 15, weekly_off: [0] };
const night: ShiftDef = { start_time: '22:00', end_time: '06:00', break_minutes: 30, grace_minutes: 10, weekly_off: [0] };
const at = (date: string, time: string) => zonedTime(date, time, tz);

test('zoned time conversion uses the company time zone', () => {
  assert.equal(at('2026-03-02', '09:30').toISOString(), '2026-03-02T04:00:00.000Z');
  assert.equal(localDate(new Date('2026-03-01T20:00:00Z'), tz), '2026-03-02');
  assert.equal(zonedTime('2026-01-15', '09:00', 'America/New_York').toISOString(), '2026-01-15T14:00:00.000Z');
  assert.deepEqual(monthRange(2028, 2), ['2028-02-01', '2028-02-29']);
});

test('overnight shifts end on the next day and attribute punches to the shift start date', () => {
  const win = shiftWindow('2026-03-02', night, tz);
  assert.equal(win.minutes, 480);
  assert.equal(scheduledMinutes(night, tz), 450);
  assert.equal(attributeWorkDate(at('2026-03-02', '22:05'), night, tz), '2026-03-02');
  assert.equal(attributeWorkDate(at('2026-03-03', '00:30'), night, tz), '2026-03-02');
  assert.equal(attributeWorkDate(at('2026-03-03', '21:50'), night, tz), '2026-03-03');
});

test('late, early, break and overtime are calculated from the shift', () => {
  const ok = evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:40'), at('2026-03-02', '18:30'), new Date());
  assert.equal(ok.late_minutes, 0); // inside grace
  assert.equal(ok.status, 'present');
  const late = evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:50'), at('2026-03-02', '17:30'), new Date());
  assert.equal(late.late_minutes, 20);
  assert.equal(late.early_minutes, 60);
  assert.equal(late.worked_minutes, 460 - 60);
  const overtime = evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:30'), at('2026-03-02', '20:30'), new Date());
  assert.equal(overtime.overtime_minutes, 120);
  const tiny = evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:30'), at('2026-03-02', '10:00'), new Date());
  assert.equal(tiny.worked_minutes, 30); // break not deducted for short days
});

test('half day and absent thresholds', () => {
  assert.equal(evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:30'), at('2026-03-02', '14:00'), new Date()).status, 'half_day');
  assert.equal(evaluateDay(day, policy, '2026-03-02', at('2026-03-02', '09:30'), at('2026-03-02', '11:00'), new Date()).status, 'absent');
});

test('work on weekly off or holiday is entirely overtime and never late', () => {
  const sunday = '2026-03-01';
  assert.equal(dayTypeFor(sunday, day, new Set(), policy), 'weekly_off');
  assert.equal(dayTypeFor('2026-03-02', day, new Set(['2026-03-02']), policy), 'holiday');
  const ev = evaluateDay(day, policy, sunday, at(sunday, '11:00'), at(sunday, '15:00'), new Date(), 'weekly_off');
  assert.equal(ev.overtime_minutes, 180);
  assert.equal(ev.late_minutes, 0);
});

test('missing punch-out is flagged only after the open window expires', () => {
  const start = at('2026-03-02', '09:30');
  assert.equal(evaluateDay(day, policy, '2026-03-02', start, null, new Date(start.getTime() + 3600000)).status, 'in_progress');
  assert.equal(evaluateDay(day, policy, '2026-03-02', start, null, new Date(start.getTime() + 25 * 3600000)).status, 'missing_punch');
  assert.throws(() => evaluateDay(day, policy, '2026-03-02', start, new Date(start.getTime() - 60000), new Date()), RuleError);
});

test('punch planning prevents duplicates and recovers from stale open records', () => {
  const none = () => null;
  const base = { policy, shift: day, holidayDates: new Set<string>(), existingForDate: none };
  const first = planPunch({ ...base, action: 'in', now: at('2026-03-02', '09:35'), open: null });
  assert.equal(first.insert?.work_date, '2026-03-02');
  const open: AttRow = { id: 'a1', work_date: '2026-03-02', punch_in: first.insert!.punch_in, punch_out: null, status: 'in_progress', worked_minutes: 0, late_minutes: 0, early_minutes: 0 };
  assert.throws(() => planPunch({ ...base, action: 'in', now: at('2026-03-02', '10:00'), open }), /already punched in/);
  const out = planPunch({ ...base, action: 'out', now: at('2026-03-02', '18:35'), open });
  assert.equal(out.update?.changes.status, 'present');
  assert.throws(() => planPunch({ ...base, action: 'out', now: at('2026-03-02', '18:35'), open: null }), RuleError);
  const next = planPunch({ ...base, action: 'in', now: at('2026-03-04', '09:30'), open });
  assert.equal(next.flagOpen, 'a1'); // stale record flagged, new day starts normally
  assert.throws(() => planPunch({ ...base, action: 'in', now: at('2026-03-02', '19:00'), open: null, existingForDate: () => ({ ...open, punch_out: first.insert!.punch_in }) }), /already recorded/);
});

test('night shift punch-out after midnight completes the original shift date', () => {
  const open: AttRow = { id: 'n1', work_date: '2026-03-02', punch_in: at('2026-03-02', '22:00').toISOString(), punch_out: null, status: 'in_progress', worked_minutes: 0, late_minutes: 0, early_minutes: 0 };
  const plan = planPunch({ action: 'out', now: at('2026-03-03', '06:05'), policy, shift: night, holidayDates: new Set(), open, existingForDate: () => null });
  assert.equal(plan.update?.changes.status, 'present');
  assert.equal(plan.update?.changes.worked_minutes, 485 - 30 + 0);
});

test('calendar day status and holiday applicability', () => {
  const base = { today: '2026-03-10', dayType: 'working' as const };
  assert.equal(dayStatus({ ...base, date: '2026-03-09' }), 'absent');
  assert.equal(dayStatus({ ...base, date: '2026-03-10' }), 'not_punched');
  assert.equal(dayStatus({ ...base, date: '2026-03-11' }), 'upcoming');
  assert.equal(dayStatus({ ...base, date: '2026-03-08', dayType: 'weekly_off' }), 'weekly_off');
  assert.equal(dayStatus({ ...base, date: '2026-03-09', leave: { half_day: false } }), 'leave');
  assert.equal(dayStatus({ ...base, date: '2026-03-01', joining: '2026-03-05' }), 'not_joined');
  assert.equal(holidayApplies({ holiday_date: 'x', locations: [], teams: [] }, { location: 'Pune' }), true);
  assert.equal(holidayApplies({ holiday_date: 'x', locations: ['Mumbai'] }, { location: 'Pune' }), false);
  assert.equal(holidayApplies({ holiday_date: 'x', teams: ['Sales'] }, { department: 'sales' }), true);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(DEFAULT_SHIFT.weekly_off[0], 0);
});

test('permission matrix separates HR, finance and employee access', () => {
  assert.equal(can('admin', 'payroll.manage'), true);
  assert.equal(can('hr_manager', 'attendance.correct'), true);
  assert.equal(can('hr_manager', 'payroll.view_all'), false);
  assert.equal(can('finance', 'employees.manage'), false);
  assert.equal(can('finance', 'billing.manage'), true);
  assert.equal(can('employee', 'attendance.self'), true);
  assert.equal(can('employee', 'attendance.view_all'), false);
  assert.equal(can('employee', 'payslip.self'), true);
  assert.equal(can('unknown', 'attendance.self'), false);
});
