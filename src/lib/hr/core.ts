/** Dependency-free helpers shared by server APIs, the browser demo store and tests. */
import { monthRange } from './time';

export class RuleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type Role = 'admin' | 'hr_manager' | 'employee' | 'finance';
export const ROLES: Role[] = ['admin', 'hr_manager', 'employee', 'finance'];
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator', hr_manager: 'HR Manager', employee: 'Recruiter / Employee', finance: 'Finance / Payroll',
};

const SELF = ['attendance.self', 'leave.self', 'overtime.self', 'payslip.self', 'profile.self'];
const GRANTS: Record<Role, string[]> = {
  admin: ['*'],
  hr_manager: ['employees.view', 'employees.manage', 'documents.manage', 'attendance.view_all', 'attendance.correct',
    'holidays.manage', 'shifts.manage', 'leave.manage', 'overtime.manage', 'hr.reports'],
  finance: ['payroll.manage', 'payroll.view_all', 'billing.manage', 'billing.view', 'finance.reports'],
  employee: [],
};

export function can(role: Role | string, permission: string): boolean {
  const grants = GRANTS[role as Role];
  if (!grants) return false;
  if (grants.includes('*')) return true;
  return grants.includes(permission) || SELF.includes(permission);
}

/** Pages visible in navigation, evaluated with the same permission matrix the APIs use. */
export function canAny(role: Role | string, permissions: string[]): boolean {
  return permissions.some(p => can(role, p));
}

type Route<T> = { method: string; path: string; handle: T };
export function matchRoute<T>(routes: Route<T>[], method: string, segments: string[]): { handle: T; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((part, index) => {
      if (part.startsWith(':')) { params[part.slice(1)] = decodeURIComponent(segments[index]); return true; }
      return part === segments[index];
    });
    if (ok) return { handle: route.handle, params };
  }
  return null;
}

/** Money is calculated in integer minor units to avoid floating point drift. */
export const toMinor = (value: unknown): number => Math.round(Number(value || 0) * 100);
export const fromMinor = (value: number): number => Math.round(value) / 100;
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function assertDate(value: unknown, label: string): string {
  const text = String(value ?? '').slice(0, 10);
  if (!DATE_RE.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) throw new RuleError(400, `${label} must be a valid date`);
  return text;
}

export function monthRangeOf(value: string | null): [string, string] {
  const m = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new RuleError(400, 'Month must be YYYY-MM');
  return monthRange(Number(m[1]), Number(m[2]));
}

/** Human-readable permission catalogue; the Roles & Permissions page renders the live `can()` matrix from it. */
export const PERMISSION_LABELS: Array<[group: string, id: string, label: string]> = [
  ['Human Resources', 'employees.view', 'View employee profiles'], ['Human Resources', 'employees.manage', 'Create, edit and deactivate employees'], ['Human Resources', 'documents.manage', 'Manage employee documents'],
  ['Human Resources', 'attendance.view_all', 'View all-employee attendance'], ['Human Resources', 'attendance.correct', 'Correct attendance (audited)'], ['Human Resources', 'holidays.manage', 'Manage holiday calendar'],
  ['Human Resources', 'shifts.manage', 'Manage shifts and assignments'], ['Human Resources', 'leave.manage', 'Approve leave, manage balances and types'], ['Human Resources', 'overtime.manage', 'Approve overtime, set rates'], ['Human Resources', 'hr.reports', 'HR reports'],
  ['Finance & Billing', 'payroll.view_all', 'View payroll and salary structures'], ['Finance & Billing', 'payroll.manage', 'Run, approve and finalize payroll'], ['Finance & Billing', 'billing.view', 'View invoices and payments'],
  ['Finance & Billing', 'billing.manage', 'Issue invoices, record payments'], ['Self-service (all roles)', 'attendance.self', 'Punch in/out, own attendance'], ['Self-service (all roles)', 'leave.self', 'Apply for leave'],
  ['Self-service (all roles)', 'overtime.self', 'Request overtime'], ['Self-service (all roles)', 'payslip.self', 'View own payslips'],
];
