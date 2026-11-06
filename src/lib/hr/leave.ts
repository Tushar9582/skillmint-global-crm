import { RuleError, round2 } from './core';
import { eachDate } from './time';
import type { DayType } from './attendance';

export interface LeaveTypeRule { count_weekends: boolean; count_holidays: boolean }
export interface LeaveSpan { start_date: string; end_date: string; half_day?: boolean; half_day_part?: string | null }

/** Counts the days a leave request consumes under the leave type's weekend/holiday policy. */
export function countLeave(input: { start: string; end: string; half_day: boolean; dayTypeAt: (date: string) => DayType; rule: LeaveTypeRule }) {
  if (input.end < input.start) throw new RuleError(400, 'End date must be on or after the start date');
  if (input.half_day && input.start !== input.end) throw new RuleError(400, 'Half-day leave must be for a single day');
  const all = eachDate(input.start, input.end);
  if (all.length > 366) throw new RuleError(400, 'Leave cannot span more than a year');
  const dates = all.filter(d => {
    const type = input.dayTypeAt(d);
    return type === 'working' || (type === 'weekly_off' && input.rule.count_weekends) || (type === 'holiday' && input.rule.count_holidays);
  });
  if (!dates.length) throw new RuleError(400, 'All selected dates are weekly offs or holidays under this leave type\'s policy');
  return { dates, days: input.half_day ? 0.5 : dates.length };
}

export function daysByYear(dates: string[], half: boolean): Record<number, number> {
  const out: Record<number, number> = {};
  for (const d of dates) { const y = Number(d.slice(0, 4)); out[y] = (out[y] ?? 0) + (half ? 0.5 : 1); }
  return out;
}

export function spansOverlap(a: LeaveSpan, b: LeaveSpan): boolean {
  if (a.end_date < b.start_date || b.end_date < a.start_date) return false;
  const sameHalfDay = a.half_day && b.half_day && a.start_date === b.start_date;
  return !(sameHalfDay && a.half_day_part && b.half_day_part && a.half_day_part !== b.half_day_part);
}

export function leaveBalance(i: { allocated: number; adjustment: number; used: number; pending: number }) {
  const total = round2(i.allocated + i.adjustment);
  return { total, used: round2(i.used), pending: round2(i.pending), remaining: round2(total - i.used - i.pending) };
}

export function assertSufficientBalance(requestedByYear: Record<number, number>, remainingByYear: Record<number, number>, allowNegative: boolean) {
  if (allowNegative) return;
  for (const [year, days] of Object.entries(requestedByYear)) {
    const left = remainingByYear[Number(year)] ?? 0;
    if (days > left + 1e-9) throw new RuleError(409, `Insufficient leave balance for ${year}: ${left} day(s) remaining, ${days} requested`);
  }
}
