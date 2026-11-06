import { sql } from '@/lib/db';

export type LeaveDay = { half_day: boolean; paid: boolean };

/** Approved leave days that count against the employee's attendance, keyed by date. */
export async function leaveCover(orgId: string, employeeId: string, from: string, to: string): Promise<Map<string, LeaveDay>> {
  const rows = await sql<{ half_day: boolean; paid: boolean; dates: string[] }>(
    `SELECT r.half_day,t.paid,r.counted_dates::text[] AS dates FROM hr_leave_requests r JOIN hr_leave_types t ON t.id=r.leave_type_id
     WHERE r.organization_id=$1 AND r.employee_id=$2 AND r.status='approved' AND r.start_date<=$4::date AND r.end_date>=$3::date`,
    [orgId, employeeId, from, to]);
  const cover = new Map<string, LeaveDay>();
  for (const r of rows) for (const d of r.dates) if (d >= from && d <= to) cover.set(d, { half_day: r.half_day, paid: r.paid });
  return cover;
}
