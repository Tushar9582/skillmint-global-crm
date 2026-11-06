import { RuleError, fromMinor, toMinor } from './core';
import { hourlyRateMinor, multiplierFor, overtimePayMinor, type OvertimeRates } from './overtime';
import type { DayType } from './attendance';

export type LopBasis = 'working_days' | 'calendar_days' | 'fixed_30';
export interface SalaryComponent { name: string; type: 'fixed' | 'percent_basic'; value: number }
export interface Structure { basic: number; allowances: SalaryComponent[]; deductions: SalaryComponent[] }
export interface StatutoryRule { code: string; name: string; base: 'basic' | 'gross'; rate_percent: number; base_cap: number | null }
export interface DayInput {
  date: string; day_type: DayType; status: string;
  leave: { half_day: boolean; paid: boolean } | null;
  record: { status: string; punch_in?: unknown; overtime_minutes?: number } | null;
}
export interface OvertimeInput { minutes: number; day_type: DayType; multiplier?: number | null }
export interface Adjustment { kind: 'bonus' | 'deduction'; label: string; amount: number }
export interface PayrollInput {
  structure: Structure; statutory: StatutoryRule[]; days: DayInput[]; overtime: OvertimeInput[]; adjustments: Adjustment[];
  rates: OvertimeRates; lopBasis: LopBasis; standardDailyHours: number; calendarDays: number; monthComplete: boolean;
}
export interface PayLine { kind: 'earning' | 'deduction'; code: string; label: string; amount: number; note?: string }
export interface PayrollResult {
  working_days: number; lop_days: number; payable_days: number; basic: number; gross: number; lop_deduction: number; overtime_minutes: number; overtime_pay: number;
  bonus: number; other_deductions: number; statutory_deductions: number; total_deductions: number; net: number; lines: PayLine[];
  warnings: Array<{ code: string; message: string; blocking: boolean }>;
}

export function validateComponents(items: unknown, label: string): SalaryComponent[] {
  if (items === undefined || items === null || items === '') return [];
  if (!Array.isArray(items) || items.length > 30) throw new RuleError(400, `${label} must be a list of at most 30 items`);
  return items.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = String(item.name ?? '').trim();
    const type = item.type === 'percent_basic' ? 'percent_basic' : item.type === 'fixed' ? 'fixed' : null;
    const value = Number(item.value);
    if (!name || name.length > 80) throw new RuleError(400, `${label} #${i + 1} needs a name`);
    if (!type) throw new RuleError(400, `${label} #${i + 1} has an invalid type`);
    if (!Number.isFinite(value) || value < 0 || value > (type === 'percent_basic' ? 100 : 1e8)) throw new RuleError(400, `${label} #${i + 1} has an invalid amount`);
    return { name, type, value };
  });
}

const componentMinor = (c: SalaryComponent, basicMinor: number) => c.type === 'fixed' ? toMinor(c.value) : Math.round(basicMinor * c.value / 100);

/** Days that reduce pay. Missing punches are provisional loss of pay until HR corrects them. */
export function lopForDay(d: DayInput, today: string): { lop: number; unresolved: string | null } {
  if (d.status === 'not_joined' || d.status === 'inactive') return { lop: d.day_type === 'working' ? 1 : 0, unresolved: null };
  const worked = d.record && ['present', 'half_day', 'absent', 'missing_punch', 'in_progress'].includes(d.record.status) && d.record.punch_in;
  const leave = d.leave;
  if (worked) {
    if (d.record!.status === 'missing_punch') return { lop: 1, unresolved: 'Missing punch-out' };
    if (d.record!.status === 'in_progress') return { lop: 0, unresolved: d.date < today ? 'Open punch' : null };
    if (d.record!.status === 'half_day') return { lop: 0.5, unresolved: null };
    if (d.record!.status === 'absent') return { lop: leave && leave.half_day ? 0.5 : 1, unresolved: null };
    return { lop: 0, unresolved: null };
  }
  if (leave) {
    if (d.day_type !== 'working' && !leave.paid) return { lop: 0, unresolved: null };
    if (leave.half_day) return { lop: (leave.paid ? 0 : 0.5) + 0.5, unresolved: null }; // the other half needed attendance
    return { lop: leave.paid ? 0 : 1, unresolved: null };
  }
  if (d.day_type !== 'working') return { lop: 0, unresolved: null };
  if (d.date > today) return { lop: 0, unresolved: null };
  if (d.date === today) return { lop: 0, unresolved: 'Today is not complete' };
  return { lop: 1, unresolved: null };
}

export function computePayroll(input: PayrollInput, today: string): PayrollResult {
  const warnings: PayrollResult['warnings'] = [];
  const basicMinor = toMinor(input.structure.basic);
  const workingDays = input.days.filter(d => d.day_type === 'working').length;
  let lopDays = 0; const unresolved: string[] = [];
  for (const d of input.days) { const r = lopForDay(d, today); lopDays += r.lop; if (r.unresolved) unresolved.push(`${d.date}: ${r.unresolved}`); }
  const divisor = input.lopBasis === 'fixed_30' ? 30 : input.lopBasis === 'calendar_days' ? input.calendarDays : workingDays || input.calendarDays;
  lopDays = Math.min(lopDays, workingDays);
  const lines: PayLine[] = [{ kind: 'earning', code: 'BASIC', label: 'Basic salary', amount: fromMinor(basicMinor) }];
  let grossMinor = basicMinor;
  for (const a of input.structure.allowances) { const m = componentMinor(a, basicMinor); grossMinor += m; lines.push({ kind: 'earning', code: 'ALLOW', label: a.name, amount: fromMinor(m) }); }
  const lopMinor = divisor > 0 ? Math.round(grossMinor / divisor * lopDays) : 0;
  const earnedGross = grossMinor - lopMinor; const earnedBasic = basicMinor - (divisor > 0 ? Math.round(basicMinor / divisor * lopDays) : 0);
  if (lopMinor) lines.push({ kind: 'deduction', code: 'LOP', label: `Loss of pay (${lopDays} day${lopDays === 1 ? '' : 's'})`, amount: fromMinor(lopMinor), note: `${fromMinor(grossMinor)} / ${divisor} x ${lopDays}` });

  const hourly = hourlyRateMinor(basicMinor, workingDays, input.standardDailyHours);
  let otMinor = 0; let otMinutes = 0;
  for (const o of input.overtime) { otMinutes += o.minutes; otMinor += overtimePayMinor(o.minutes, hourly, o.multiplier ?? multiplierFor(o.day_type, input.rates)); }
  if (otMinor) lines.push({ kind: 'earning', code: 'OT', label: `Overtime (${(otMinutes / 60).toFixed(2)} h)`, amount: fromMinor(otMinor) });
  let bonusMinor = 0; let otherMinor = 0;
  for (const a of input.adjustments) {
    const m = toMinor(a.amount);
    if (a.kind === 'bonus') { bonusMinor += m; lines.push({ kind: 'earning', code: 'BONUS', label: a.label, amount: fromMinor(m) }); }
    else { otherMinor += m; lines.push({ kind: 'deduction', code: 'ADJ', label: a.label, amount: fromMinor(m) }); }
  }
  for (const d of input.structure.deductions) { const m = componentMinor(d, basicMinor); otherMinor += m; lines.push({ kind: 'deduction', code: 'DED', label: d.name, amount: fromMinor(m) }); }
  let statMinor = 0;
  for (const rule of input.statutory) {
    let base = rule.base === 'basic' ? earnedBasic : earnedGross;
    if (rule.base_cap !== null && rule.base_cap !== undefined) base = Math.min(base, toMinor(rule.base_cap));
    const m = Math.round(Math.max(0, base) * rule.rate_percent / 100); statMinor += m;
    lines.push({ kind: 'deduction', code: rule.code, label: rule.name, amount: fromMinor(m), note: `${rule.rate_percent}% of ${rule.base}${rule.base_cap != null ? ` (capped at ${rule.base_cap})` : ''}` });
  }
  const totalDed = lopMinor + otherMinor + statMinor;
  const net = grossMinor + otMinor + bonusMinor - totalDed;
  if (unresolved.length) warnings.push({ code: 'UNRESOLVED_ATTENDANCE', blocking: true, message: `Resolve attendance first: ${unresolved.slice(0, 5).join('; ')}${unresolved.length > 5 ? ` (+${unresolved.length - 5} more)` : ''}` });
  if (!input.monthComplete) warnings.push({ code: 'MONTH_OPEN', blocking: true, message: 'The pay period has not ended; figures are provisional.' });
  if (net < 0) warnings.push({ code: 'NEGATIVE_NET', blocking: true, message: 'Net pay is negative. Review deductions and adjustments.' });
  return {
    working_days: workingDays, lop_days: lopDays, payable_days: Math.max(0, workingDays - lopDays), basic: fromMinor(basicMinor), gross: fromMinor(grossMinor), lop_deduction: fromMinor(lopMinor),
    overtime_minutes: otMinutes, overtime_pay: fromMinor(otMinor), bonus: fromMinor(bonusMinor), other_deductions: fromMinor(otherMinor), statutory_deductions: fromMinor(statMinor),
    total_deductions: fromMinor(totalDed), net: fromMinor(net), lines, warnings,
  };
}

export function validateStatutory(d: Record<string, unknown>) {
  const rate = Number(d.rate_percent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new RuleError(400, 'Rate must be between 0 and 100');
  const base = d.base === 'gross' ? 'gross' : d.base === 'basic' ? 'basic' : null;
  if (!base) throw new RuleError(400, 'Base must be basic or gross');
  const capRaw = d.base_cap; const cap = capRaw === undefined || capRaw === null || capRaw === '' ? null : Number(capRaw);
  if (cap !== null && (!Number.isFinite(cap) || cap < 0)) throw new RuleError(400, 'Wage cap is invalid');
  return { rate_percent: rate, base, base_cap: cap };
}
