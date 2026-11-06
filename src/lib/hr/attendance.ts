import { RuleError } from './core';
import { addDays, localDate, minutesBetween, zonedTime } from './time';

export interface ShiftDef {
  id?: string | null; name?: string; start_time: string; end_time: string;
  break_minutes: number; grace_minutes: number; weekly_off: number[];
}
export interface Policy {
  timezone: string; default_weekly_off: number[]; full_day_ratio: number; half_day_ratio: number;
  max_open_hours: number; overtime_min_minutes: number; standard_daily_hours: number;
}
export interface AttRow {
  id?: string; employee_id?: string; work_date: string; punch_in: string | Date | null; punch_out: string | Date | null;
  status: string; worked_minutes: number; late_minutes: number; early_minutes: number; overtime_minutes?: number; shift_id?: string | null;
}
export type DayType = 'working' | 'weekly_off' | 'holiday';

export const DEFAULT_POLICY: Policy = {
  timezone: 'Asia/Kolkata', default_weekly_off: [0], full_day_ratio: 0.75, half_day_ratio: 0.4,
  max_open_hours: 20, overtime_min_minutes: 30, standard_daily_hours: 8,
};
export const DEFAULT_SHIFT: ShiftDef = { name: 'General', start_time: '09:30', end_time: '18:30', break_minutes: 60, grace_minutes: 15, weekly_off: [0] };
/** A break is only deducted when the employee worked at least this long. */
export const MIN_FOR_BREAK = 240;
const EARLY_PUNCH_BUFFER_MIN = 240;

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000);

export function shiftWindow(date: string, shift: ShiftDef, tz: string) {
  const start = zonedTime(date, shift.start_time, tz);
  let end = zonedTime(date, shift.end_time, tz);
  if (end <= start) end = zonedTime(addDays(date, 1), shift.end_time, tz); // overnight shift
  return { start, end, minutes: minutesBetween(start, end) };
}
export const scheduledMinutes = (shift: ShiftDef, tz: string): number =>
  Math.max(0, shiftWindow('2000-01-03', shift, tz).minutes - shift.break_minutes);

/** Finds the shift date a punch belongs to, so a 02:00 punch-in on a night shift counts for the day the shift began. */
export function attributeWorkDate(punch: Date, shift: ShiftDef | null, tz: string): string {
  const today = localDate(punch, tz);
  if (!shift) return today;
  const candidates = [addDays(today, -1), today, addDays(today, 1)];
  let best: { date: string; gap: number } | null = null;
  for (const date of candidates) {
    const win = shiftWindow(date, shift, tz);
    if (punch < addMinutes(win.start, -EARLY_PUNCH_BUFFER_MIN) || punch > win.end) continue;
    const gap = Math.abs(punch.getTime() - win.start.getTime());
    if (!best || gap < best.gap) best = { date, gap };
  }
  return best?.date ?? today;
}

export function dayTypeFor(date: string, shift: ShiftDef, holidayDates: Set<string>, policy: Policy): DayType {
  if (holidayDates.has(date)) return 'holiday';
  const off = shift.weekly_off?.length ? shift.weekly_off : policy.default_weekly_off;
  return off.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 'weekly_off' : 'working';
}

export interface Evaluation { status: string; worked_minutes: number; late_minutes: number; early_minutes: number; overtime_minutes: number }

export function evaluateDay(shift: ShiftDef, policy: Policy, workDate: string, punchIn: Date, punchOut: Date | null,
  now: Date, dayType: DayType = 'working'): Evaluation {
  const win = shiftWindow(workDate, shift, policy.timezone);
  const sched = scheduledMinutes(shift, policy.timezone);
  const late = dayType === 'working' && punchIn > addMinutes(win.start, shift.grace_minutes) ? minutesBetween(win.start, punchIn) : 0;
  if (!punchOut) {
    const open = now.getTime() - punchIn.getTime() < policy.max_open_hours * 3600000;
    return { status: open ? 'in_progress' : 'missing_punch', worked_minutes: 0, late_minutes: late, early_minutes: 0, overtime_minutes: 0 };
  }
  const raw = minutesBetween(punchIn, punchOut);
  if (raw < 0) throw new RuleError(400, 'Punch-out must be after punch-in');
  const worked = Math.max(0, raw - (raw >= MIN_FOR_BREAK ? shift.break_minutes : 0));
  const early = dayType === 'working' && punchOut < win.end ? minutesBetween(punchOut, win.end) : 0;
  let status = 'present';
  if (dayType === 'working' && sched > 0) status = worked >= sched * policy.full_day_ratio ? 'present' : worked >= sched * policy.half_day_ratio ? 'half_day' : 'absent';
  // Work on a weekly off or holiday is entirely overtime; on working days only time beyond the schedule counts.
  const extra = dayType === 'working' ? Math.max(0, worked - sched) : worked;
  return { status, worked_minutes: worked, late_minutes: late, early_minutes: early, overtime_minutes: extra >= policy.overtime_min_minutes ? extra : 0 };
}

export interface PunchPlan { flagOpen?: string; insert?: AttRow; update?: { id?: string; changes: Partial<AttRow> } }

/** Decides what a punch does; callers persist the result inside a transaction. */
export function planPunch(input: {
  action: 'in' | 'out'; now: Date; policy: Policy; shift: ShiftDef | null; holidayDates: Set<string>;
  open: AttRow | null; existingForDate: (date: string) => AttRow | null;
}): PunchPlan {
  const { action, now, policy, open } = input;
  const shift = input.shift ?? DEFAULT_SHIFT;
  const stale = open ? now.getTime() - new Date(open.punch_in as string).getTime() >= policy.max_open_hours * 3600000 : false;
  if (action === 'out') {
    if (!open || stale) throw new RuleError(409, 'No active punch-in found. Ask HR to correct a missing punch-in.');
    const inAt = new Date(open.punch_in as string);
    const type = dayTypeFor(open.work_date, shift, input.holidayDates, policy);
    const ev = evaluateDay(shift, policy, open.work_date, inAt, now, now, type);
    return { update: { id: open.id, changes: { punch_out: now.toISOString(), ...ev } } };
  }
  if (open && !stale) throw new RuleError(409, 'You are already punched in. Punch out first.');
  const date = attributeWorkDate(now, shift, policy.timezone);
  const existing = input.existingForDate(date);
  if (existing && existing.id !== open?.id) throw new RuleError(409, `Attendance for ${date} is already recorded. Ask HR for a correction.`);
  const type = dayTypeFor(date, shift, input.holidayDates, policy);
  const ev = evaluateDay(shift, policy, date, now, null, now, type);
  return {
    flagOpen: open && stale ? open.id : undefined,
    insert: { work_date: date, punch_in: now.toISOString(), punch_out: null, shift_id: shift.id ?? null, ...ev },
  };
}

export interface HolidayLike { holiday_date: string; locations?: string[] | null; teams?: string[] | null }
export function holidayApplies(h: HolidayLike, emp: { location?: string | null; department?: string | null }): boolean {
  const locs = (h.locations ?? []).map(x => x.toLowerCase());
  const teams = (h.teams ?? []).map(x => x.toLowerCase());
  const locationOk = !locs.length || (!!emp.location && locs.includes(emp.location.toLowerCase()));
  const teamOk = !teams.length || (!!emp.department && teams.includes(emp.department.toLowerCase()));
  return locationOk && teamOk;
}

export function dayStatus(i: {
  date: string; today: string; joining?: string | null; exit?: string | null; dayType: DayType;
  leave?: { half_day: boolean } | null; record?: Pick<AttRow, 'status' | 'punch_in'> | null;
}): string {
  if (i.joining && i.date < i.joining) return 'not_joined';
  if (i.exit && i.date > i.exit) return 'inactive';
  if (i.record?.punch_in) return i.record.status;
  if (i.leave) return i.leave.half_day ? 'half_day_leave' : 'leave';
  if (i.dayType !== 'working') return i.dayType;
  if (i.date > i.today) return 'upcoming';
  return i.date === i.today ? 'not_punched' : 'absent';
}
