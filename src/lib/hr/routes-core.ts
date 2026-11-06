import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError, hashPassword } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { scanResume } from '@/lib/antivirus';
import { downloadResume, removeResume, storeResume } from '@/lib/storage';
import { json } from '@/lib/http';
import { NextResponse } from 'next/server';
import { ROLES, UUID_RE, assertDate, can } from './core';
import { addDays, eachDate, localDate, monthRange, zonedTime } from './time';
import { DEFAULT_SHIFT, dayStatus, dayTypeFor, evaluateDay, planPunch, scheduledMinutes, type AttRow } from './attendance';
import { v, has } from './validate';
import {
  EMPLOYEE_COLUMNS, EMPLOYEE_FROM, assertMonthOpen, buildUpdate, csvResponse, ensureProfiles, getSettings, holidayDates, jsonBody, myEmployee,
  need, shiftFor, shiftResolver, type Ctx, type Row, type ServerRoute,
} from './server';
import { leaveCover } from './leave-cover';

const STATUSES = ['probation', 'active', 'notice', 'resigned', 'terminated', 'inactive'] as const;
const OFF_STATUSES = ['resigned', 'terminated', 'inactive'];
const DOC_TYPES = ['id_proof', 'address_proof', 'offer_letter', 'contract', 'education', 'experience', 'other'] as const;
const PERSONAL_KEYS = ['blood_group', 'nationality', 'personal_email', 'alternate_phone'];

async function guarded<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new HttpError(409, message);
    throw error;
  }
}

function parseEmployee(data: Row, create: boolean): Row {
  const out: Row = {};
  const set = (key: string, value: unknown) => { if (create || has(data, key)) out[key] = value; };
  if (create || has(data, 'full_name')) out.full_name = v.str(data.full_name, 'Full name', { required: true, max: 150 });
  if (create || has(data, 'email')) out.email = v.email(data.email);
  set('phone', v.phone(data.phone));
  set('department', v.str(data.department, 'Department', { max: 100 }));
  set('designation', v.str(data.designation, 'Designation', { max: 100 }));
  set('location', v.str(data.location, 'Location', { max: 100 }));
  if (create || has(data, 'joining_date')) out.joining_date = v.date(data.joining_date, 'Joining date', create);
  if (has(data, 'exit_date')) out.exit_date = v.date(data.exit_date, 'Exit date');
  if (create || has(data, 'employment_status')) out.employment_status = v.oneOf(data.employment_status ?? 'active', 'Employment status', STATUSES, true);
  if (has(data, 'manager_id')) out.manager_id = v.uuid(data.manager_id, 'Reporting manager');
  set('date_of_birth', v.date(data.date_of_birth, 'Date of birth'));
  set('gender', v.oneOf(data.gender, 'Gender', ['female', 'male', 'other']));
  set('marital_status', v.oneOf(data.marital_status, 'Marital status', ['single', 'married', 'other']));
  set('address', v.str(data.address, 'Address', { max: 600 }));
  set('emergency_contact_name', v.str(data.emergency_contact_name, 'Emergency contact', { max: 150 }));
  set('emergency_contact_relation', v.str(data.emergency_contact_relation, 'Relation', { max: 80 }));
  set('emergency_contact_phone', v.phone(data.emergency_contact_phone, 'Emergency phone'));
  if (has(data, 'personal')) {
    const source = (data.personal && typeof data.personal === 'object' ? data.personal : {}) as Row;
    out.personal = JSON.stringify(Object.fromEntries(PERSONAL_KEYS.filter(k => source[k]).map(k => [k, String(source[k]).slice(0, 120)])));
  } else if (create) out.personal = '{}';
  return out;
}

export async function loadEmployee(orgId: string, id: string, client?: PoolClient): Promise<Row> {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Employee not found');
  const row = await one<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 AND e.id=$2`, [orgId, id], client);
  if (!row) throw new HttpError(404, 'Employee not found');
  return row;
}

async function assertNoManagerCycle(orgId: string, employeeId: string, managerId: string, client: PoolClient) {
  if (employeeId === managerId) throw new HttpError(400, 'An employee cannot report to themselves');
  const cycle = await one(
    `WITH RECURSIVE chain AS (
       SELECT id,manager_id FROM hr_employees WHERE organization_id=$1 AND id=$2
       UNION SELECT h.id,h.manager_id FROM hr_employees h JOIN chain c ON h.id=c.manager_id WHERE h.organization_id=$1)
     SELECT 1 FROM chain WHERE id=$3`, [orgId, managerId, employeeId], client);
  if (cycle) throw new HttpError(400, 'This reporting line would create a loop');
}

/** Own profile, or any profile for users who may manage/view employees. */
async function accessibleEmployee(ctx: Ctx, id: string, permission = 'employees.view'): Promise<Row> {
  const employee = await loadEmployee(ctx.actor.organization_id, id);
  if (employee.user_id !== ctx.actor.id) need(ctx.actor, permission);
  return employee;
}

const ATT_COLUMNS = `a.id,a.employee_id,a.work_date::text AS work_date,a.shift_id,a.punch_in,a.punch_out,a.status,a.worked_minutes,
  a.late_minutes,a.early_minutes,a.overtime_minutes,a.source,a.notes`;

export async function monthDays(orgId: string, emp: Row, from: string, to: string, tz: string, today: string) {
  const employeeId = String(emp.id);
  const [records, holidays, leave] = await Promise.all([
    sql<AttRow & { employee_id: string }>(`SELECT ${ATT_COLUMNS} FROM hr_attendance a WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.work_date BETWEEN $3::date AND $4::date`, [orgId, employeeId, from, to]),
    holidayDates(orgId, emp, from, to),
    leaveCover(orgId, employeeId, from, to),
  ]);
  const settings = await getSettings(orgId);
  const shiftAt = await shiftResolver(orgId, employeeId, from, to);
  const byDate = new Map(records.map(r => [r.work_date, r]));
  const out: Array<Row> = [];
  for (const date of eachDate(from, to)) {
    const shift = shiftAt(date) ?? DEFAULT_SHIFT;
    const dayType = dayTypeFor(date, shift, holidays, settings);
    const record = byDate.get(date) ?? null;
    out.push({
      date, day_type: dayType, leave: leave.get(date) ?? null, record,
      status: dayStatus({ date, today, joining: emp.joining_date as string, exit: emp.exit_date as string, dayType, leave: leave.get(date) ?? null, record }),
    });
  }
  return out;
}

/** Everyone's attendance status for today, used by the register and the dashboard. */
export async function todayRegister(orgId: string) {
  await ensureProfiles(orgId);
  const settings = await getSettings(orgId);
  const today = localDate(new Date(), settings.timezone);
  const employees = await sql<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 AND e.active=true ORDER BY e.full_name`, [orgId]);
  const rows: Row[] = [];
  for (const emp of employees) {
    const days = await monthDays(orgId, emp, today, today, settings.timezone, today);
    rows.push({ employee_id: emp.id, employee_name: emp.full_name, employee_code: emp.employee_code, department: emp.department, ...days[0] });
  }
  const count = (s: string) => rows.filter(r => r.status === s).length;
  return { data: rows, summary: { total: rows.length, present: rows.filter(r => ['present', 'in_progress', 'half_day'].includes(String(r.status))).length,
    absent: count('not_punched') + count('absent'), on_leave: count('leave') + count('half_day_leave'), missing_punch: count('missing_punch') }, date: today };
}

async function applyEdit(ctx: Ctx, employee: Row, workDate: string, data: Row, existing: Row | null) {
  const orgId = ctx.actor.organization_id;
  await assertMonthOpen(orgId, workDate);
  const settings = await getSettings(orgId);
  const inTime = data.in_time ? v.time(data.in_time, 'Punch-in time') : null;
  const outTime = data.out_time ? v.time(data.out_time, 'Punch-out time') : null;
  if (!inTime) throw new HttpError(400, 'Punch-in time is required');
  const shift = (await shiftFor(orgId, String(employee.id), workDate)) ?? DEFAULT_SHIFT;
  const punchIn = zonedTime(workDate, inTime, settings.timezone);
  let punchOut: Date | null = null;
  if (outTime) {
    punchOut = zonedTime(workDate, outTime, settings.timezone);
    if (punchOut <= punchIn) punchOut = zonedTime(addDays(workDate, 1), outTime, settings.timezone); // overnight
  }
  const holidays = await holidayDates(orgId, employee, workDate, workDate);
  const ev = evaluateDay(shift, settings, workDate, punchIn, punchOut, new Date(), dayTypeFor(workDate, shift, holidays, settings));
  const reason = v.str(data.reason, 'Correction reason', { required: true, max: 500 });
  const values = { punch_in: punchIn.toISOString(), punch_out: punchOut?.toISOString() ?? null, ...ev };
  return transaction(async client => {
    let saved: Row;
    if (existing) {
      const q = buildUpdate('hr_attendance', { ...values, source: 'correction', notes: reason }, orgId, String(existing.id));
      saved = (await one<Row>(q.text, q.args, client)) as Row;
    } else {
      saved = (await one<Row>(
        `INSERT INTO hr_attendance(organization_id,employee_id,work_date,shift_id,punch_in,punch_out,status,worked_minutes,late_minutes,
           early_minutes,overtime_minutes,source,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'correction',$12) RETURNING *`,
        [orgId, employee.id, workDate, shift.id ?? null, values.punch_in, values.punch_out, ev.status, ev.worked_minutes,
          ev.late_minutes, ev.early_minutes, ev.overtime_minutes, reason], client)) as Row;
    }
    const old = existing ? { punch_in: existing.punch_in, punch_out: existing.punch_out, status: existing.status, worked_minutes: existing.worked_minutes } : {};
    await sql(`INSERT INTO hr_attendance_corrections(organization_id,attendance_id,employee_id,old_values,new_values,reason,corrected_by)
               VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [orgId, saved.id, employee.id, JSON.stringify(old), JSON.stringify(values), reason, ctx.actor.id], client);
    await audit(ctx.actor, existing ? 'attendance_correct' : 'attendance_manual_entry', 'hr_attendance', String(saved.id), { employee_id: employee.id, work_date: workDate, reason }, client);
    return saved;
  });
}

export const coreRoutes: ServerRoute[] = [
  { method: 'GET', path: 'me', handle: async ctx => {
    const employee = await myEmployee(ctx.actor);
    return json({ data: { employee, permissions: { view_all: can(ctx.actor.role, 'attendance.view_all') } } });
  } },

  // ---- Employees ----
  { method: 'GET', path: 'employees', handle: async ctx => {
    need(ctx.actor, 'employees.view');
    await ensureProfiles(ctx.actor.organization_id);
    const where = ['e.organization_id=$1']; const args: unknown[] = [ctx.actor.organization_id];
    const add = (sqlText: string, value: unknown) => { args.push(value); where.push(sqlText.replaceAll('?', `$${args.length}`)); };
    const q = ctx.query.get('q')?.trim(); if (q) add('(e.full_name ILIKE ? OR e.email ILIKE ? OR e.employee_code ILIKE ? OR e.phone ILIKE ?)', `%${q.slice(0, 80)}%`);
    const dep = ctx.query.get('department'); if (dep) add('e.department=?', dep);
    const status = ctx.query.get('status'); if (status && (STATUSES as readonly string[]).includes(status)) add('e.employment_status=?', status);
    const active = ctx.query.get('active'); if (active === 'true' || active === 'false') add('e.active=?', active === 'true');
    const data = await sql(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE ${where.join(' AND ')} ORDER BY e.employee_code LIMIT 500`, args);
    const departments = await sql<{ department: string }>(`SELECT DISTINCT department FROM hr_employees WHERE organization_id=$1 AND department IS NOT NULL ORDER BY 1`, [ctx.actor.organization_id]);
    return json({ data, departments: departments.map(d => d.department) });
  } },

  { method: 'POST', path: 'employees', handle: async ctx => {
    need(ctx.actor, 'employees.manage');
    const data = await jsonBody(ctx.request);
    const values = parseEmployee(data, true);
    const createLogin = v.bool(data.create_login);
    const created = await guarded(() => transaction(async client => {
      const orgId = ctx.actor.organization_id;
      await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`hr_code:${orgId}`], client);
      if (values.email) {
        const dup = await one('SELECT id FROM hr_employees WHERE organization_id=$1 AND lower(email)=$2 AND active=true', [orgId, values.email], client);
        if (dup) throw new HttpError(409, 'An active employee with this email already exists');
      }
      if (values.manager_id) await loadEmployee(orgId, String(values.manager_id), client);
      let userId: string | null = null;
      if (createLogin) {
        if (ctx.actor.role !== 'admin') throw new HttpError(403, 'Only an Administrator can create login accounts');
        const role = v.oneOf(data.login_role ?? 'employee', 'Login role', ROLES, true);
        const password = String(data.temporary_password || '');
        if (!values.email) throw new HttpError(400, 'Email is required to create a login');
        if (password.length < 12 || password.length > 128) throw new HttpError(400, 'Temporary password must have at least 12 characters');
        const user = await one<{ id: string }>(
          `INSERT INTO users(organization_id,full_name,email,password_hash,role,team,must_change_password) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id`,
          [orgId, values.full_name, values.email, await hashPassword(password), role, values.department], client);
        userId = user!.id;
      }
      const next = await one<{ n: number }>(
        `SELECT coalesce(max(substring(employee_code from 5)::int),0)+1 AS n FROM hr_employees WHERE organization_id=$1 AND employee_code ~ '^EMP-[0-9]+$'`, [orgId], client);
      const code = `EMP-${String(next!.n).padStart(4, '0')}`;
      const keys = Object.keys(values);
      const cols = ['organization_id', 'user_id', 'employee_code', 'created_by', ...keys];
      const row = await one<Row>(
        `INSERT INTO hr_employees(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        [orgId, userId, code, ctx.actor.id, ...keys.map(k => values[k])], client);
      await sql(`INSERT INTO hr_employment_history(organization_id,employee_id,event_type,details,effective_date,changed_by)
                 VALUES($1,$2,'joined',$3::jsonb,$4,$5)`,
        [orgId, row!.id, JSON.stringify({ department: values.department, designation: values.designation }), values.joining_date, ctx.actor.id], client);
      await audit(ctx.actor, 'employee_create', 'hr_employees', String(row!.id), { employee_code: code, login: Boolean(userId) }, client);
      return row;
    }), 'An employee or login with this email already exists');
    return json({ data: created }, 201);
  } },

  { method: 'GET', path: 'employees/:id', handle: async ctx => {
    const employee = await accessibleEmployee(ctx, ctx.params.id);
    const orgId = ctx.actor.organization_id;
    const [history, documents, shift] = await Promise.all([
      sql(`SELECT id,event_type,details,effective_date::text AS effective_date,created_at FROM hr_employment_history WHERE organization_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 100`, [orgId, employee.id]),
      sql(`SELECT id,doc_type,title,original_filename,mime_type,file_size,created_at FROM hr_employee_documents WHERE organization_id=$1 AND employee_id=$2 AND archived_at IS NULL ORDER BY created_at DESC`, [orgId, employee.id]),
      shiftFor(orgId, String(employee.id), localDate(new Date(), (await getSettings(orgId)).timezone)),
    ]);
    return json({ data: { employee, history, documents, shift } });
  } },

  { method: 'PATCH', path: 'employees/:id', handle: async ctx => {
    need(ctx.actor, 'employees.manage');
    const data = await jsonBody(ctx.request);
    const values = parseEmployee(data, false);
    const updated = await guarded(() => transaction(async client => {
      const orgId = ctx.actor.organization_id;
      const previous = await loadEmployee(orgId, ctx.params.id, client);
      if (values.manager_id) { await loadEmployee(orgId, String(values.manager_id), client); await assertNoManagerCycle(orgId, ctx.params.id, String(values.manager_id), client); }
      if (values.email && values.email !== previous.email) {
        const dup = await one('SELECT id FROM hr_employees WHERE organization_id=$1 AND lower(email)=$2 AND active=true AND id<>$3', [orgId, values.email, ctx.params.id], client);
        if (dup) throw new HttpError(409, 'An active employee with this email already exists');
      }
      if (values.employment_status) {
        const off = OFF_STATUSES.includes(String(values.employment_status));
        values.active = !off;
        if (off && previous.user_id === ctx.actor.id) throw new HttpError(400, 'You cannot deactivate your own account');
        if (off && !values.exit_date && !previous.exit_date) values.exit_date = localDate(new Date(), (await getSettings(orgId, client)).timezone);
        if (!off) values.exit_date = null;
      }
      const q = buildUpdate('hr_employees', values, orgId, ctx.params.id);
      const row = (await one<Row>(q.text, q.args, client)) as Row;
      for (const key of ['department', 'designation', 'location', 'manager_id', 'employment_status'] as const) {
        if (has(values, key) && String(values[key] ?? '') !== String(previous[key] ?? '')) {
          await sql(`INSERT INTO hr_employment_history(organization_id,employee_id,event_type,details,changed_by) VALUES($1,$2,$3,$4::jsonb,$5)`,
            [orgId, ctx.params.id, `${key}_change`, JSON.stringify({ from: previous[key] ?? null, to: values[key] ?? null }), ctx.actor.id], client);
        }
      }
      // Login access: HR may disable it, but only an Administrator may re-enable it.
      if (previous.user_id && has(values, 'active')) {
        if (values.active === false) {
          await sql('UPDATE users SET active=false,updated_at=now() WHERE id=$1 AND organization_id=$2', [previous.user_id, orgId], client);
          await sql('DELETE FROM sessions WHERE user_id=$1', [previous.user_id], client);
        } else if (ctx.actor.role === 'admin') {
          await sql('UPDATE users SET active=true,updated_at=now() WHERE id=$1 AND organization_id=$2', [previous.user_id, orgId], client);
        }
      }
      await audit(ctx.actor, 'employee_update', 'hr_employees', ctx.params.id, { fields: Object.keys(values) }, client);
      return row;
    }), 'An employee with this email already exists');
    return json({ data: updated });
  } },

  { method: 'POST', path: 'employees/:id/documents', handle: async ctx => {
    need(ctx.actor, 'documents.manage');
    const employee = await loadEmployee(ctx.actor.organization_id, ctx.params.id);
    const form = await ctx.request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Select a document to upload');
    const bytes = Buffer.from(await file.arrayBuffer());
    const kinds: Array<[string, string, (b: Buffer) => boolean]> = [
      ['.pdf', 'application/pdf', b => b.subarray(0, 5).toString('ascii') === '%PDF-'],
      ['.png', 'image/png', b => b[0] === 0x89 && b.subarray(1, 4).toString('ascii') === 'PNG'],
      ['.jpg', 'image/jpeg', b => b[0] === 0xff && b[1] === 0xd8],
      ['.jpeg', 'image/jpeg', b => b[0] === 0xff && b[1] === 0xd8],
    ];
    const lower = file.name.toLowerCase();
    const kind = kinds.find(([ext, , sig]) => lower.endsWith(ext) && sig(bytes));
    if (!kind || bytes.length > 5 * 1024 * 1024) throw new HttpError(400, 'Only valid PDF, PNG or JPG files up to 5 MB are accepted');
    await scanResume(bytes);
    const docType = v.oneOf(form.get('doc_type') ?? 'other', 'Document type', DOC_TYPES, true)!;
    const title = v.str(form.get('title') || file.name, 'Title', { required: true, max: 150 })!;
    const key = `${ctx.actor.organization_id}/${randomUUID()}/${randomUUID()}${kind[0]}`;
    await storeResume(key, bytes, kind[1]);
    try {
      const row = await one<Row>(
        `INSERT INTO hr_employee_documents(organization_id,employee_id,doc_type,title,original_filename,mime_type,file_size,storage_key,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,doc_type,title,original_filename,created_at`,
        [ctx.actor.organization_id, employee.id, docType, title, file.name.replace(/[\r\n"\\]/g, '_').slice(0, 150), kind[1], bytes.length, key, ctx.actor.id]);
      await audit(ctx.actor, 'employee_document_upload', 'hr_employees', String(employee.id), { doc_type: docType });
      return json({ data: row }, 201);
    } catch (error) { await removeResume(key); throw error; }
  } },

  { method: 'GET', path: 'employees/:id/documents/:docId', handle: async ctx => {
    await accessibleEmployee(ctx, ctx.params.id, 'documents.manage');
    if (!UUID_RE.test(ctx.params.docId)) throw new HttpError(404, 'Document not found');
    const doc = await one<Row>(`SELECT storage_key,original_filename,mime_type FROM hr_employee_documents
      WHERE id=$1 AND organization_id=$2 AND employee_id=$3 AND archived_at IS NULL`, [ctx.params.docId, ctx.actor.organization_id, ctx.params.id]);
    if (!doc) throw new HttpError(404, 'Document not found');
    await audit(ctx.actor, 'employee_document_download', 'hr_employees', ctx.params.id, { document_id: ctx.params.docId });
    const result = await downloadResume(String(doc.storage_key));
    if (result.url) return NextResponse.redirect(result.url, 303);
    return new NextResponse(new Uint8Array(result.bytes!), { headers: {
      'Content-Type': String(doc.mime_type), 'Content-Disposition': `attachment; filename="${String(doc.original_filename)}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } },

  { method: 'DELETE', path: 'employees/:id/documents/:docId', handle: async ctx => {
    need(ctx.actor, 'documents.manage');
    const row = await one(`UPDATE hr_employee_documents SET archived_at=now() WHERE id=$1 AND organization_id=$2 AND employee_id=$3 AND archived_at IS NULL RETURNING id`,
      [ctx.params.docId, ctx.actor.organization_id, ctx.params.id]);
    if (!row) throw new HttpError(404, 'Document not found');
    await audit(ctx.actor, 'employee_document_archive', 'hr_employees', ctx.params.id, { document_id: ctx.params.docId });
    return json({ ok: true });
  } },

  // ---- Holidays ----
  { method: 'GET', path: 'holidays', handle: async ctx => {
    const year = Number(ctx.query.get('year') || new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Invalid year');
    const data = await sql(`SELECT id,name,holiday_date::text AS holiday_date,holiday_type,locations,teams,notes FROM hr_holidays
      WHERE organization_id=$1 AND holiday_date BETWEEN $2::date AND $3::date ORDER BY holiday_date`, [ctx.actor.organization_id, `${year}-01-01`, `${year}-12-31`]);
    return json({ data });
  } },
  { method: 'POST', path: 'holidays', handle: async ctx => {
    need(ctx.actor, 'holidays.manage');
    const row = await saveHoliday(ctx, await jsonBody(ctx.request), null);
    return json({ data: row }, 201);
  } },
  { method: 'PATCH', path: 'holidays/:id', handle: async ctx => {
    need(ctx.actor, 'holidays.manage');
    return json({ data: await saveHoliday(ctx, await jsonBody(ctx.request), ctx.params.id) });
  } },
  { method: 'DELETE', path: 'holidays/:id', handle: async ctx => {
    need(ctx.actor, 'holidays.manage');
    const found = await one<{ holiday_date: string }>(`SELECT holiday_date::text AS holiday_date FROM hr_holidays WHERE id=$1 AND organization_id=$2`, [ctx.params.id, ctx.actor.organization_id]);
    if (found) await assertMonthOpen(ctx.actor.organization_id, found.holiday_date);
    const row = await one(`DELETE FROM hr_holidays WHERE id=$1 AND organization_id=$2 RETURNING id`, [ctx.params.id, ctx.actor.organization_id]);
    if (!row) throw new HttpError(404, 'Holiday not found');
    await audit(ctx.actor, 'holiday_delete', 'hr_holidays', ctx.params.id, {});
    return json({ ok: true });
  } },

  // ---- Attendance ----
  { method: 'GET', path: 'attendance/me', handle: async ctx => {
    const orgId = ctx.actor.organization_id;
    const employee = await myEmployee(ctx.actor);
    const settings = await getSettings(orgId);
    const now = new Date(); const today = localDate(now, settings.timezone);
    const shift = (await shiftFor(orgId, String(employee.id), today)) ?? DEFAULT_SHIFT;
    const open = await one<Row>(`SELECT ${ATT_COLUMNS} FROM hr_attendance a WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.punch_in IS NOT NULL AND a.punch_out IS NULL ORDER BY a.punch_in DESC LIMIT 1`, [orgId, employee.id]);
    const record = open && now.getTime() - new Date(String(open.punch_in)).getTime() < settings.max_open_hours * 3600000
      ? open : await one<Row>(`SELECT ${ATT_COLUMNS} FROM hr_attendance a WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.work_date=$3::date`, [orgId, employee.id, today]);
    const live = record && !record.punch_out ? { ...record, worked_minutes: Math.max(0, Math.round((now.getTime() - new Date(String(record.punch_in)).getTime()) / 60000)) } : record;
    return json({ data: { employee, today, server_time: now.toISOString(), timezone: settings.timezone, record: live,
      shift: { ...shift, scheduled_minutes: scheduledMinutes(shift, settings.timezone) }, punched_in: Boolean(live && !live.punch_out) } });
  } },

  { method: 'POST', path: 'attendance/punch', handle: async ctx => {
    need(ctx.actor, 'attendance.self');
    const action = v.oneOf((await jsonBody(ctx.request)).action, 'Action', ['in', 'out'] as const, true)!;
    const employee = await myEmployee(ctx.actor);
    if (!employee.active) throw new HttpError(403, 'Your employee record is inactive');
    const orgId = ctx.actor.organization_id;
    const result = await guarded(() => transaction(async client => {
      await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`punch:${employee.id}`], client);
      const settings = await getSettings(orgId, client);
      const now = new Date(); const today = localDate(now, settings.timezone);
      const shift = await shiftFor(orgId, String(employee.id), today, client);
      const holidays = await holidayDates(orgId, employee, addDays(today, -1), addDays(today, 1), client);
      const open = await one<AttRow & { id: string }>(`SELECT ${ATT_COLUMNS} FROM hr_attendance a WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.punch_in IS NOT NULL AND a.punch_out IS NULL ORDER BY a.punch_in DESC LIMIT 1`, [orgId, employee.id], client);
      const nearby = await sql<AttRow>(`SELECT ${ATT_COLUMNS} FROM hr_attendance a WHERE a.organization_id=$1 AND a.employee_id=$2 AND a.work_date BETWEEN $3::date AND $4::date`, [orgId, employee.id, addDays(today, -1), addDays(today, 1)], client);
      const plan = planPunch({ action, now, policy: settings, shift, holidayDates: holidays, open, existingForDate: d => nearby.find(r => r.work_date === d) ?? null });
      if (plan.flagOpen) await sql(`UPDATE hr_attendance SET status='missing_punch',updated_at=now() WHERE id=$1 AND organization_id=$2`, [plan.flagOpen, orgId], client);
      let saved: Row;
      if (plan.insert) {
        const r = plan.insert;
        saved = (await one<Row>(
          `INSERT INTO hr_attendance(organization_id,employee_id,work_date,shift_id,punch_in,status,worked_minutes,late_minutes,early_minutes,overtime_minutes)
           VALUES($1,$2,$3,$4,$5,$6,0,$7,0,0) RETURNING id,work_date::text AS work_date,punch_in,status`,
          [orgId, employee.id, r.work_date, r.shift_id, r.punch_in, r.status, r.late_minutes], client)) as Row;
      } else {
        const q = buildUpdate('hr_attendance', plan.update!.changes as Row, orgId, String(plan.update!.id));
        saved = (await one<Row>(q.text, q.args, client)) as Row;
      }
      await audit(ctx.actor, action === 'in' ? 'attendance_punch_in' : 'attendance_punch_out', 'hr_attendance', String(saved.id), {}, client);
      return saved;
    }), 'Attendance for this day is already recorded');
    return json({ data: result, message: action === 'in' ? 'Punched in' : 'Punched out' }, 201);
  } },

  { method: 'GET', path: 'attendance', handle: async ctx => {
    const orgId = ctx.actor.organization_id;
    const all = can(ctx.actor.role, 'attendance.view_all');
    const own = await myEmployee(ctx.actor);
    const args: unknown[] = [orgId]; const where = ['a.organization_id=$1'];
    const add = (text: string, value: unknown) => { args.push(value); where.push(text.replace('?', `$${args.length}`)); };
    const target = all ? ctx.query.get('employee_id') : String(own.id);
    if (target) { v.uuid(target, 'Employee'); add('a.employee_id=?', target); }
    const from = ctx.query.get('from'); const to = ctx.query.get('to');
    if (from) add('a.work_date>=?::date', assertDate(from, 'From date'));
    if (to) add('a.work_date<=?::date', assertDate(to, 'To date'));
    const status = ctx.query.get('status');
    if (status) add('a.status=?', v.oneOf(status, 'Status', ['in_progress', 'present', 'half_day', 'absent', 'missing_punch'] as const));
    const issue = ctx.query.get('issue');
    if (issue === 'late') where.push('a.late_minutes>0');
    if (issue === 'early') where.push('a.early_minutes>0');
    if (issue === 'missing') where.push(`a.status='missing_punch'`);
    const dep = ctx.query.get('department'); if (all && dep) add('e.department=?', dep);
    const data = await sql(`SELECT ${ATT_COLUMNS},e.full_name AS employee_name,e.employee_code,e.department
      FROM hr_attendance a JOIN hr_employees e ON e.id=a.employee_id WHERE ${where.join(' AND ')} ORDER BY a.work_date DESC,e.full_name LIMIT 1000`, args);
    return json({ data, timezone: (await getSettings(orgId)).timezone });
  } },

  { method: 'GET', path: 'attendance/today', handle: async ctx => {
    need(ctx.actor, 'attendance.view_all');
    return json(await todayRegister(ctx.actor.organization_id));
  } },

  { method: 'GET', path: 'attendance/calendar', handle: async ctx => {
    const orgId = ctx.actor.organization_id; const own = await myEmployee(ctx.actor);
    const employeeId = ctx.query.get('employee_id') || String(own.id);
    const employee = employeeId === own.id ? own : (need(ctx.actor, 'attendance.view_all'), await loadEmployee(orgId, employeeId));
    const month = String(ctx.query.get('month') || '').match(/^(\d{4})-(\d{2})$/);
    const settings = await getSettings(orgId);
    const [year, mon] = month ? [Number(month[1]), Number(month[2])] : localDate(new Date(), settings.timezone).split('-').slice(0, 2).map(Number);
    const [from, to] = monthRange(year, mon);
    const days = await monthDays(orgId, employee, from, to, settings.timezone, localDate(new Date(), settings.timezone));
    return json({ data: days, employee: { id: employee.id, full_name: employee.full_name, employee_code: employee.employee_code }, month: `${year}-${String(mon).padStart(2, '0')}` });
  } },

  { method: 'GET', path: 'attendance/export', handle: async ctx => {
    need(ctx.actor, 'attendance.view_all');
    const orgId = ctx.actor.organization_id; const settings = await getSettings(orgId);
    const m = String(ctx.query.get('month') || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new HttpError(400, 'Month must be YYYY-MM');
    const [from, to] = monthRange(Number(m[1]), Number(m[2]));
    const employees = await sql<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM} WHERE e.organization_id=$1 ORDER BY e.employee_code`, [orgId]);
    const today = localDate(new Date(), settings.timezone);
    const tz = settings.timezone; const time = (x: unknown) => x ? new Date(String(x)).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '';
    const rows: unknown[][] = [];
    for (const emp of employees) {
      for (const d of await monthDays(orgId, emp, from, to, tz, today)) {
        if (d.status === 'not_joined' || d.status === 'inactive') continue;
        const r = d.record as Row | null;
        rows.push([emp.employee_code, emp.full_name, emp.department, d.date, d.status, time(r?.punch_in), time(r?.punch_out),
          r ? (Number(r.worked_minutes) / 60).toFixed(2) : '', r?.late_minutes ?? '', r?.early_minutes ?? '', r ? (Number(r.overtime_minutes) / 60).toFixed(2) : '']);
      }
    }
    await audit(ctx.actor, 'attendance_export', 'hr_attendance', null, { month: `${m[1]}-${m[2]}` });
    return csvResponse(`attendance-${m[1]}-${m[2]}.csv`, ['Employee ID', 'Name', 'Department', 'Date', 'Status', 'In', 'Out', 'Worked Hours', 'Late Minutes', 'Early Leaving Minutes', 'Overtime Hours'], rows);
  } },

  { method: 'PATCH', path: 'attendance/:id', handle: async ctx => {
    need(ctx.actor, 'attendance.correct');
    const existing = await one<Row>(`SELECT a.*,a.work_date::text AS work_date_text FROM hr_attendance a WHERE a.id=$1 AND a.organization_id=$2`, [ctx.params.id, ctx.actor.organization_id]);
    if (!existing) throw new HttpError(404, 'Attendance record not found');
    const employee = await loadEmployee(ctx.actor.organization_id, String(existing.employee_id));
    return json({ data: await applyEdit(ctx, employee, String(existing.work_date_text), await jsonBody(ctx.request), existing) });
  } },
  { method: 'POST', path: 'attendance/manual', handle: async ctx => {
    need(ctx.actor, 'attendance.correct');
    const data = await jsonBody(ctx.request);
    const employee = await loadEmployee(ctx.actor.organization_id, String(v.uuid(data.employee_id, 'Employee', true)));
    const workDate = v.date(data.work_date, 'Work date', true)!;
    const existing = await one<Row>(`SELECT * FROM hr_attendance WHERE organization_id=$1 AND employee_id=$2 AND work_date=$3::date`, [ctx.actor.organization_id, employee.id, workDate]);
    return json({ data: await applyEdit(ctx, employee, workDate, data, existing) }, 201);
  } },
  { method: 'GET', path: 'attendance/:id/corrections', handle: async ctx => {
    need(ctx.actor, 'attendance.view_all');
    const data = await sql(`SELECT c.id,c.old_values,c.new_values,c.reason,c.created_at,u.full_name AS corrected_by_name
      FROM hr_attendance_corrections c LEFT JOIN users u ON u.id=c.corrected_by
      WHERE c.organization_id=$1 AND c.attendance_id=$2 ORDER BY c.created_at DESC`, [ctx.actor.organization_id, ctx.params.id]);
    return json({ data });
  } },
];

async function saveHoliday(ctx: Ctx, data: Row, id: string | null): Promise<Row> {
  const orgId = ctx.actor.organization_id;
  const values: Row = {};
  if (!id || has(data, 'name')) values.name = v.str(data.name, 'Holiday name', { required: true, max: 150 });
  if (!id || has(data, 'holiday_date')) values.holiday_date = v.date(data.holiday_date, 'Holiday date', true);
  if (!id || has(data, 'holiday_type')) values.holiday_type = v.oneOf(data.holiday_type ?? 'public', 'Holiday type', ['public', 'company', 'optional', 'regional'] as const, true);
  if (!id || has(data, 'locations')) values.locations = v.list(data.locations, 'Locations');
  if (!id || has(data, 'teams')) values.teams = v.list(data.teams, 'Teams');
  if (!id || has(data, 'notes')) values.notes = v.str(data.notes, 'Notes', { max: 500 });
  await assertMonthOpen(orgId, [String(values.holiday_date ?? (await one<{ d: string }>('SELECT holiday_date::text AS d FROM hr_holidays WHERE id=$1', [id]))?.d ?? '1970-01-01')]);
  const row = await guarded(async () => {
    if (!id) {
      const keys = Object.keys(values);
      return one<Row>(`INSERT INTO hr_holidays(organization_id,created_by,${keys.join(',')}) VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`,
        [orgId, ctx.actor.id, ...keys.map(k => values[k])]);
    }
    const q = buildUpdate('hr_holidays', values, orgId, id);
    return one<Row>(q.text, q.args);
  }, 'A holiday with this name already exists on that date');
  if (!row) throw new HttpError(404, 'Holiday not found');
  await audit(ctx.actor, id ? 'holiday_update' : 'holiday_create', 'hr_holidays', String(row.id), { name: row.name });
  return row;
}
