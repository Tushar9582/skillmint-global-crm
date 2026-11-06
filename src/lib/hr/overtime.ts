import { RuleError, round2 } from './core';
import type { DayType } from './attendance';

export interface OvertimeRates { weekday: number; weekoff: number; holiday: number }

export const multiplierFor = (dayType: DayType, rates: OvertimeRates): number =>
  dayType === 'holiday' ? rates.holiday : dayType === 'weekly_off' ? rates.weekoff : rates.weekday;

/** Hourly rate in minor units (paise) from monthly basic pay. */
export function hourlyRateMinor(monthlyBasicMinor: number, workingDays: number, dailyHours: number): number {
  if (workingDays <= 0 || dailyHours <= 0) return 0;
  return Math.round(monthlyBasicMinor / (workingDays * dailyHours));
}

export const overtimePayMinor = (minutes: number, hourlyMinor: number, multiplier: number): number =>
  Math.round((minutes / 60) * hourlyMinor * multiplier);

export function validateRequestedMinutes(calculated: number, requested: number | null): number {
  if (calculated <= 0) throw new RuleError(409, 'No overtime was calculated for that date');
  const minutes = requested ?? calculated;
  if (!Number.isInteger(minutes) || minutes <= 0) throw new RuleError(400, 'Requested overtime must be a positive whole number of minutes');
  if (minutes > calculated) throw new RuleError(400, `Requested overtime cannot exceed the ${calculated} minutes calculated from attendance`);
  return minutes;
}

export function approvedMinutes(requested: number, decision: 'approved' | 'rejected', approved: number | null): number {
  if (decision === 'rejected') return 0;
  const minutes = approved ?? requested;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > requested) throw new RuleError(400, `Approved overtime must be between 0 and ${requested} minutes`);
  return minutes;
}

/** Overtime minutes that may reach payroll: only approved requests when policy requires approval. */
export function payableOvertime(rows: Array<{ calculated: number; approved: number | null; status?: string }>, requiresApproval: boolean): number {
  return rows.reduce((sum, r) => sum + (requiresApproval ? (r.status === 'approved' ? r.approved ?? 0 : 0) : r.calculated), 0);
}

export const hours = (minutes: number): number => round2(minutes / 60);
