import type { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { api } from '@/lib/http';
import { HttpError, type Actor } from '@/lib/auth';
import { one, sql } from '@/lib/db';
import { can, matchRoute, RuleError } from './core';
import { DEFAULT_POLICY, DEFAULT_SHIFT, dayTypeFor, type Policy, type ShiftDef, holidayApplies } from './attendance';

export type Ctx = { actor: Actor; params: Record<string, string>; query: URLSearchParams; request: NextRequest };
export type ServerRoute = { method: string; path: string; handle: (ctx: Ctx) => Promise<Response> };
export type Row = Record<string, unknown>;

export function routeApi(routes: ServerRoute[], prefix: string) {
  return api(async (request, actor) => {
    const segments = request.nextUrl.pathname.slice(prefix.length).split('/').filter(Boolean);
    const found = matchRoute(routes, request.method, segments);
    if (!found) throw new HttpError(404, 'Not found');
    try {
      return await found.handle({ actor, params: found.params, query: request.nextUrl.searchParams, request });
    } catch (error) {
      if (error instanceof RuleError) throw new HttpError(error.status, error.message);
      throw error;
    }
  });
}

export function need(actor: Actor, permission: string): void {
  if (!can(actor.role, permission)) throw new HttpError(403, 'You do not have permission for this action');
}

export async function jsonBody(request: NextRequest): Promise<Row> {
  const input = await request.json();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Expected JSON object');
  return input as Row;
}

export function buildUpdate(table: string, values: Row, orgId: string, id: string, extra = ',updated_at=now()') {
  const keys = Object.keys(values);
  if (!keys.length) throw new HttpError(400, 'No editable fields provided');
  const setters = keys.map((key, index) => `${key}=$${index + 1}`).join(',');
  return {
    text: `UPDATE ${table} SET ${setters}${extra} WHERE organization_id=$${keys.length + 1} AND id=$${keys.length + 2} RETURNING *`,
    args: [...keys.map(key => values[key]), orgId, id],
  };
}

export interface SettingsRow extends Policy {
  organization_id: string; overtime_requires_approval: boolean; payroll_lop_basis: 'working_days' | 'calendar_days' | 'fixed_30'; payroll_currency: string;
  overtime_weekday_multiplier: number; overtime_weekoff_multiplier: number; overtime_holiday_multiplier: number;
}

export async function getSettings(orgId: string, client?: PoolClient): Promise<SettingsRow> {
  await sql('INSERT INTO hr_settings(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [orgId], client);
  const row = await one<Row>('SELECT * FROM hr_settings WHERE organization_id=$1', [orgId], client);
  const r = row as Row;
  return {
    ...DEFAULT_POLICY, organization_id: orgId, timezone: String(r.timezone),
    default_weekly_off: r.default_weekly_off as number[], standard_daily_hours: Number(r.standard_daily_hours),
    full_day_ratio: Number(r.full_day_ratio), half_day_ratio: Number(r.half_day_ratio),
    max_open_hours: Number(r.max_open_hours), overtime_min_minutes: Number(r.overtime_min_minutes),
    overtime_requires_approval: Boolean(r.overtime_requires_approval),
    payroll_lop_basis: (r.payroll_lop_basis ?? 'working_days') as SettingsRow['payroll_lop_basis'], payroll_currency: String(r.payroll_currency ?? 'INR'),
    overtime_weekday_multiplier: Number(r.overtime_weekday_multiplier),
    overtime_weekoff_multiplier: Number(r.overtime_weekoff_multiplier),
    overtime_holiday_multiplier: Number(r.overtime_holiday_multiplier),
  };
}

/** Creates HR profiles for login accounts that predate the HR module. Idempotent. */
export async function ensureProfiles(orgId: string, client?: PoolClient): Promise<void> {
  await sql(
    `INSERT INTO hr_employees(organization_id,user_id,employee_code,full_name,email,department,employment_status,active,joining_date)
     SELECT u.organization_id,u.id,'EMP-'||lpad((base.n+row_number() OVER (ORDER BY u.created_at,u.id))::text,4,'0'),
            u.full_name,u.email,u.team,CASE WHEN u.active THEN 'active' ELSE 'inactive' END,u.active,u.created_at::date
     FROM users u,(SELECT coalesce(max(substring(employee_code from 5)::int),0) AS n FROM hr_employees
                   WHERE organization_id=$1 AND employee_code ~ '^EMP-[0-9]+$') base
     WHERE u.organization_id=$1 AND NOT EXISTS (SELECT 1 FROM hr_employees h WHERE h.user_id=u.id)
     ON CONFLICT DO NOTHING`, [orgId], client);
}

export const EMPLOYEE_COLUMNS = `e.id,e.user_id,e.employee_code,e.full_name,e.email,e.phone,e.department,e.designation,e.location,
  e.joining_date::text AS joining_date,e.exit_date::text AS exit_date,e.employment_status,e.manager_id,e.active,
  e.date_of_birth::text AS date_of_birth,e.gender,e.marital_status,e.address,e.emergency_contact_name,
  e.emergency_contact_relation,e.emergency_contact_phone,e.personal,e.created_at,m.full_name AS manager_name,u.role AS login_role`;
export const EMPLOYEE_FROM = `hr_employees e LEFT JOIN hr_employees m ON m.id=e.manager_id LEFT JOIN users u ON u.id=e.user_id`;

export async function myEmployee(actor: Actor): Promise<Row> {
  let row = await one<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 AND e.user_id=$2`,
    [actor.organization_id, actor.id]);
  if (!row) {
    await ensureProfiles(actor.organization_id);
    row = await one<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 AND e.user_id=$2`,
      [actor.organization_id, actor.id]);
  }
  if (!row) throw new HttpError(404, 'No HR profile is linked to your account');
  return row;
}

export async function shiftFor(orgId: string, employeeId: string, date: string, client?: PoolClient): Promise<(ShiftDef & { id: string }) | null> {
  const row = await one<Row>(
    `SELECT s.id,s.name,to_char(s.start_time,'HH24:MI') AS start_time,to_char(s.end_time,'HH24:MI') AS end_time,
            s.break_minutes,s.grace_minutes,s.weekly_off
     FROM hr_shift_assignments a JOIN hr_shifts s ON s.id=a.shift_id
     WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.effective_from<=$3::date
       AND (a.effective_to IS NULL OR a.effective_to>=$3::date)
     ORDER BY a.effective_from DESC,a.created_at DESC LIMIT 1`, [orgId, employeeId, date], client);
  return row as (ShiftDef & { id: string }) | null;
}

/** Loads shift assignments once and resolves the shift effective on any date in the range. */
export async function shiftResolver(orgId: string, employeeId: string, from: string, to: string) {
  const rows = await sql<Row & { effective_from: string; effective_to: string | null }>(
    `SELECT s.id,s.name,to_char(s.start_time,'HH24:MI') AS start_time,to_char(s.end_time,'HH24:MI') AS end_time,
            s.break_minutes,s.grace_minutes,s.weekly_off,a.effective_from::text AS effective_from,a.effective_to::text AS effective_to
     FROM hr_shift_assignments a JOIN hr_shifts s ON s.id=a.shift_id
     WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.effective_from<=$4::date AND (a.effective_to IS NULL OR a.effective_to>=$3::date)
     ORDER BY a.effective_from DESC,a.created_at DESC`, [orgId, employeeId, from, to]);
  return (date: string): ShiftDef | null =>
    (rows.find(r => r.effective_from <= date && (!r.effective_to || r.effective_to >= date)) as unknown as ShiftDef | undefined) ?? null;
}

export async function holidayDates(orgId: string, emp: Row, from: string, to: string, client?: PoolClient): Promise<Set<string>> {
  const rows = await sql<{ holiday_date: string; locations: string[]; teams: string[] }>(
    `SELECT holiday_date::text AS holiday_date,locations,teams FROM hr_holidays
     WHERE organization_id=$1 AND holiday_date BETWEEN $2::date AND $3::date AND holiday_type<>'optional'`, [orgId, from, to], client);
  return new Set(rows.filter(h => holidayApplies(h, { location: emp.location as string, department: emp.department as string })).map(h => h.holiday_date));
}

/** Day-type resolver (working / weekly off / holiday) for one employee over a date range. */
export async function dayTypeResolver(orgId: string, emp: Row, from: string, to: string, client?: PoolClient) {
  const settings = await getSettings(orgId, client);
  const shiftAt = await shiftResolver(orgId, String(emp.id), from, to);
  const holidays = await holidayDates(orgId, emp, from, to, client);
  return { settings, at: (date: string) => dayTypeFor(date, shiftAt(date) ?? DEFAULT_SHIFT, holidays, settings) };
}

/** Finalized payroll locks the underlying attendance, leave, overtime and holiday data for that month. */
export async function assertMonthOpen(orgId: string, dates: string | string[], client?: PoolClient): Promise<void> {
  const months = [...new Set((Array.isArray(dates) ? dates : [dates]).map(d => d.slice(0, 7)))];
  for (const m of months) {
    const locked = await one('SELECT 1 FROM payroll_runs WHERE organization_id=$1 AND status=\'finalized\' AND period_year=$2 AND period_month=$3', [orgId, Number(m.slice(0, 4)), Number(m.slice(5, 7))], client);
    if (locked) throw new HttpError(409, `Payroll for ${m} is finalized; this change is locked`);
  }
}

export const csvCell = (value: unknown): string => {
  let text = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function csvResponse(filename: string, headers: string[], rows: unknown[][]): Response {
  const csv = [headers.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');
  return new Response('\uFEFF' + csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
