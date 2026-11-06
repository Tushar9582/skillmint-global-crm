import type { PoolClient } from 'pg';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { json } from '@/lib/http';
import { UUID_RE, can, toMinor } from './core';
import { localDate, monthRange } from './time';
import { v, has } from './validate';
import { computePayroll, validateComponents, validateStatutory, type PayrollResult, type Structure, type StatutoryRule } from './payroll';
import { payslipPdf } from './payslip';
import { EMPLOYEE_COLUMNS, EMPLOYEE_FROM, csvResponse, getSettings, jsonBody, myEmployee, need, type Ctx, type Row, type ServerRoute } from './server';
import { loadEmployee, monthDays } from './routes-core';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const periodLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

async function guarded<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) { if ((error as { code?: string }).code === '23505') throw new HttpError(409, message); throw error; }
}
function period(d: Row | URLSearchParams): { year: number; month: number } {
  const get = (k: string) => d instanceof URLSearchParams ? d.get(k) : d[k];
  const year = Number(get('year')); const month = Number(get('month'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new HttpError(400, 'Year and month are required');
  return { year, month };
}

const structureOf = (row: Row): Structure => ({ basic: Number(row.basic), allowances: row.allowances as Structure['allowances'], deductions: row.deductions as Structure['deductions'] });

/** Computes every employee's payroll for a month from attendance, approved leave, overtime and configured rules. */
export async function buildRunItems(orgId: string, year: number, month: number, client?: PoolClient) {
  const [from, to] = monthRange(year, month);
  const settings = await getSettings(orgId, client);
  const today = localDate(new Date(), settings.timezone);
  const employees = await sql<Row>(`SELECT ${EMPLOYEE_COLUMNS} FROM ${EMPLOYEE_FROM}
    WHERE e.organization_id=$1 AND (e.joining_date IS NULL OR e.joining_date<=$3::date) AND (e.exit_date IS NULL OR e.exit_date>=$2::date) AND (e.active=true OR e.exit_date IS NOT NULL) ORDER BY e.employee_code`, [orgId, from, to], client);
  const statutoryRows = await sql<Row>(`SELECT code,name,base,rate_percent::float AS rate_percent,base_cap::float AS base_cap FROM payroll_components WHERE organization_id=$1 AND active=true AND reviewed_at IS NOT NULL ORDER BY code`, [orgId], client);
  const statutory = statutoryRows as unknown as StatutoryRule[];
  const rates = { weekday: settings.overtime_weekday_multiplier, weekoff: settings.overtime_weekoff_multiplier, holiday: settings.overtime_holiday_multiplier };
  const items: Array<{ employee: Row; result: PayrollResult }> = []; const skipped: string[] = [];
  const calendarDays = Number(to.slice(8));
  for (const emp of employees) {
    const s = await one<Row>(`SELECT basic::float AS basic,allowances,deductions FROM payroll_salary_structures WHERE organization_id=$1 AND employee_id=$2 AND effective_from<=$3::date ORDER BY effective_from DESC LIMIT 1`, [orgId, emp.id, to], client);
    if (!s) { skipped.push(`${String(emp.full_name)} (no salary structure)`); continue; }
    const days = await monthDays(orgId, emp, from, to, settings.timezone, today);
    const adjustments = (await sql<Row>(`SELECT kind,label,amount::float AS amount FROM payroll_adjustments WHERE organization_id=$1 AND employee_id=$2 AND period_year=$3 AND period_month=$4 AND removed_at IS NULL ORDER BY created_at`, [orgId, emp.id, year, month], client)) as never;
    let overtime: Array<{ minutes: number; day_type: never; multiplier?: number | null }>;
    if (settings.overtime_requires_approval) {
      overtime = (await sql<Row>(`SELECT approved_minutes AS minutes,day_type,rate_multiplier::float AS multiplier FROM hr_overtime_requests WHERE organization_id=$1 AND employee_id=$2 AND status='approved' AND work_date BETWEEN $3::date AND $4::date AND approved_minutes>0`, [orgId, emp.id, from, to], client)) as never;
    } else {
      overtime = days.filter(d => d.record && Number((d.record as Row).overtime_minutes) > 0).map(d => ({ minutes: Number((d.record as Row).overtime_minutes), day_type: d.day_type as never }));
    }
    const result = computePayroll({
      structure: structureOf(s), statutory, days: days as never, overtime, adjustments, rates, lopBasis: settings.payroll_lop_basis,
      standardDailyHours: settings.standard_daily_hours, calendarDays, monthComplete: today > to,
    }, today);
    items.push({ employee: emp, result });
  }
  return { items, skipped, from, to, today };
}

async function persistItems(orgId: string, runId: string, built: Awaited<ReturnType<typeof buildRunItems>>, client: PoolClient) {
  await sql('DELETE FROM payroll_items WHERE run_id=$1', [runId], client);
  let gross = 0, ded = 0, ot = 0, net = 0;
  for (const { employee: e, result: r } of built.items) {
    gross += toMinor(r.gross); ded += toMinor(r.total_deductions); ot += toMinor(r.overtime_pay); net += toMinor(r.net);
    await sql(`INSERT INTO payroll_items(organization_id,run_id,employee_id,working_days,lop_days,payable_days,basic,gross,lop_deduction,overtime_minutes,overtime_pay,bonus,other_deductions,statutory_deductions,total_deductions,net,lines,warnings,employee_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb)`,
      [orgId, runId, e.id, r.working_days, r.lop_days, r.payable_days, r.basic, r.gross, r.lop_deduction, r.overtime_minutes, r.overtime_pay, r.bonus, r.other_deductions, r.statutory_deductions, r.total_deductions, r.net,
        JSON.stringify(r.lines), JSON.stringify(r.warnings), JSON.stringify({ code: e.employee_code, name: e.full_name, department: e.department, designation: e.designation, joining_date: e.joining_date, email: e.email })], client);
  }
  await sql(`UPDATE payroll_runs SET employee_count=$2,total_gross=$3,total_deductions=$4,total_overtime=$5,total_net=$6 WHERE id=$1`, [runId, built.items.length, gross / 100, ded / 100, ot / 100, net / 100], client);
}

const RUN_COLUMNS = `id,period_year,period_month,status,employee_count,total_gross::float AS total_gross,total_deductions::float AS total_deductions,total_overtime::float AS total_overtime,total_net::float AS total_net,created_at,approved_at,finalized_at,created_by,approved_by,finalized_by`;
async function loadRun(orgId: string, id: string, client?: PoolClient, lock = false): Promise<Row> {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Payroll run not found');
  const run = await one<Row>(`SELECT ${RUN_COLUMNS} FROM payroll_runs WHERE id=$1 AND organization_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, orgId], client);
  if (!run) throw new HttpError(404, 'Payroll run not found');
  return run;
}

export const payrollRoutes: ServerRoute[] = [
  // ---- Salary structures ----
  { method: 'GET', path: 'structures/summary', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all');
    return json({ data: await sql(`SELECT e.id AS employee_id,e.employee_code,e.full_name,e.department,e.designation,e.active,s.id AS structure_id,s.effective_from::text AS effective_from,s.basic::float AS basic,s.allowances,s.deductions
      FROM hr_employees e LEFT JOIN LATERAL (SELECT * FROM payroll_salary_structures x WHERE x.employee_id=e.id AND x.effective_from<=current_date ORDER BY x.effective_from DESC LIMIT 1) s ON true
      WHERE e.organization_id=$1 AND e.active=true ORDER BY e.employee_code`, [ctx.actor.organization_id]) });
  } },
  { method: 'GET', path: 'structures', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const id = v.uuid(ctx.query.get('employee_id'), 'Employee', true);
    return json({ data: await sql(`SELECT id,effective_from::text AS effective_from,basic::float AS basic,allowances,deductions,notes,created_at FROM payroll_salary_structures WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_from DESC`, [ctx.actor.organization_id, id]) });
  } },
  { method: 'POST', path: 'structures', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    const employee = await loadEmployee(orgId, String(v.uuid(d.employee_id, 'Employee', true)));
    const from = v.date(d.effective_from, 'Effective date', true)!; const basic = v.num(d.basic, 'Basic salary', { max: 1e8, required: true })!;
    const allowances = validateComponents(d.allowances, 'Allowance'); const deductions = validateComponents(d.deductions, 'Deduction');
    const row = await guarded(() => one<Row>(`INSERT INTO payroll_salary_structures(organization_id,employee_id,effective_from,basic,allowances,deductions,notes,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) RETURNING id`,
      [orgId, employee.id, from, basic, JSON.stringify(allowances), JSON.stringify(deductions), v.str(d.notes, 'Notes', { max: 300 }), ctx.actor.id]), 'A salary structure already exists for that effective date');
    await audit(ctx.actor, 'salary_structure_create', 'payroll_salary_structures', String(row!.id), { employee_id: employee.id, effective_from: from });
    return json({ data: row }, 201);
  } },

  // ---- Statutory components ----
  { method: 'GET', path: 'components', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all');
    return json({ data: await sql(`SELECT c.id,c.code,c.name,c.base,c.rate_percent::float AS rate_percent,c.base_cap::float AS base_cap,c.active,c.legal_note,c.reviewed_at,u.full_name AS reviewed_by_name FROM payroll_components c LEFT JOIN users u ON u.id=c.reviewed_by WHERE c.organization_id=$1 ORDER BY c.code`, [ctx.actor.organization_id]) });
  } },
  { method: 'POST', path: 'components', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request); const rule = validateStatutory(d);
    const row = await guarded(() => one<Row>(`INSERT INTO payroll_components(organization_id,code,name,base,rate_percent,base_cap,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [ctx.actor.organization_id, v.str(d.code, 'Code', { required: true, max: 20 })!.toUpperCase(), v.str(d.name, 'Name', { required: true, max: 100 }), rule.base, rule.rate_percent, rule.base_cap, ctx.actor.id]), 'A component with this code already exists');
    await audit(ctx.actor, 'payroll_component_create', 'payroll_components', String(row!.id), { code: d.code });
    return json({ data: row }, 201);
  } },
  { method: 'PATCH', path: 'components/:id', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    const cur = await one<Row>('SELECT * FROM payroll_components WHERE id=$1 AND organization_id=$2', [ctx.params.id, orgId]); if (!cur) throw new HttpError(404, 'Component not found');
    const rule = validateStatutory({ base: has(d, 'base') ? d.base : cur.base, rate_percent: has(d, 'rate_percent') ? d.rate_percent : cur.rate_percent, base_cap: has(d, 'base_cap') ? d.base_cap : cur.base_cap });
    const active = has(d, 'active') ? v.bool(d.active) : Boolean(cur.active);
    // Any change to a rate or base invalidates the previous legal review.
    const changed = rule.rate_percent !== Number(cur.rate_percent) || rule.base !== cur.base || rule.base_cap !== (cur.base_cap === null ? null : Number(cur.base_cap));
    const row = await one<Row>(`UPDATE payroll_components SET name=$3,base=$4,rate_percent=$5,base_cap=$6,active=$7,updated_at=now()${changed ? ',reviewed_at=NULL,reviewed_by=NULL' : ''} WHERE id=$1 AND organization_id=$2 RETURNING id,reviewed_at`,
      [ctx.params.id, orgId, has(d, 'name') ? v.str(d.name, 'Name', { required: true, max: 100 }) : cur.name, rule.base, rule.rate_percent, rule.base_cap, active]);
    await audit(ctx.actor, 'payroll_component_update', 'payroll_components', ctx.params.id, { changed });
    return json({ data: row });
  } },
  { method: 'POST', path: 'components/:id/review', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request);
    const note = v.str(d.legal_note, 'Legal reference / review note', { required: true, max: 500 });
    const row = await one<Row>(`UPDATE payroll_components SET reviewed_at=now(),reviewed_by=$3,legal_note=$4,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,reviewed_at`, [ctx.params.id, ctx.actor.organization_id, ctx.actor.id, note]);
    if (!row) throw new HttpError(404, 'Component not found');
    await audit(ctx.actor, 'payroll_component_review', 'payroll_components', ctx.params.id, { note });
    return json({ data: row });
  } },
  { method: 'GET', path: 'settings', handle: async ctx => { need(ctx.actor, 'payroll.view_all'); const s = await getSettings(ctx.actor.organization_id); return json({ data: { payroll_lop_basis: s.payroll_lop_basis, payroll_currency: s.payroll_currency } }); } },
  { method: 'PATCH', path: 'settings', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request);
    const basis = v.oneOf(d.payroll_lop_basis, 'Loss-of-pay basis', ['working_days', 'calendar_days', 'fixed_30'] as const, true)!;
    const currency = v.str(d.payroll_currency ?? 'INR', 'Currency', { max: 3 })!.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Currency must be a 3-letter code');
    await getSettings(ctx.actor.organization_id);
    await sql('UPDATE hr_settings SET payroll_lop_basis=$2,payroll_currency=$3,updated_at=now() WHERE organization_id=$1', [ctx.actor.organization_id, basis, currency]);
    await audit(ctx.actor, 'payroll_settings_update', 'hr_settings', null, { basis, currency });
    return json({ data: { payroll_lop_basis: basis, payroll_currency: currency } });
  } },

  // ---- Adjustments ----
  { method: 'GET', path: 'adjustments', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const { year, month } = period(ctx.query);
    return json({ data: await sql(`SELECT a.id,a.employee_id,e.full_name AS employee_name,a.kind,a.label,a.amount::float AS amount,a.created_at FROM payroll_adjustments a JOIN hr_employees e ON e.id=a.employee_id
      WHERE a.organization_id=$1 AND a.period_year=$2 AND a.period_month=$3 AND a.removed_at IS NULL ORDER BY a.created_at`, [ctx.actor.organization_id, year, month]) });
  } },
  { method: 'POST', path: 'adjustments', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const { year, month } = period(d);
    const employee = await loadEmployee(orgId, String(v.uuid(d.employee_id, 'Employee', true)));
    await assertRunOpen(orgId, year, month);
    const row = await one<Row>(`INSERT INTO payroll_adjustments(organization_id,employee_id,period_year,period_month,kind,label,amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [orgId, employee.id, year, month, v.oneOf(d.kind, 'Type', ['bonus', 'deduction'] as const, true), v.str(d.label, 'Label', { required: true, max: 100 }), v.num(d.amount, 'Amount', { min: 0.01, max: 1e8, required: true }), ctx.actor.id]);
    await audit(ctx.actor, 'payroll_adjustment_create', 'payroll_adjustments', String(row!.id), { kind: d.kind, year, month });
    return json({ data: row }, 201);
  } },
  { method: 'DELETE', path: 'adjustments/:id', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const orgId = ctx.actor.organization_id;
    const a = await one<Row>('SELECT period_year,period_month FROM payroll_adjustments WHERE id=$1 AND organization_id=$2 AND removed_at IS NULL', [ctx.params.id, orgId]); if (!a) throw new HttpError(404, 'Adjustment not found');
    await assertRunOpen(orgId, Number(a.period_year), Number(a.period_month));
    await sql('UPDATE payroll_adjustments SET removed_at=now() WHERE id=$1', [ctx.params.id]);
    await audit(ctx.actor, 'payroll_adjustment_remove', 'payroll_adjustments', ctx.params.id, {});
    return json({ ok: true });
  } },

  // ---- Runs ----
  { method: 'GET', path: 'runs', handle: async ctx => { need(ctx.actor, 'payroll.view_all'); return json({ data: await sql(`SELECT ${RUN_COLUMNS} FROM payroll_runs WHERE organization_id=$1 ORDER BY period_year DESC,period_month DESC`, [ctx.actor.organization_id]) }); } },
  { method: 'POST', path: 'runs', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const orgId = ctx.actor.organization_id; const { year, month } = period(await jsonBody(ctx.request));
    const settings = await getSettings(orgId); const today = localDate(new Date(), settings.timezone);
    if (`${year}-${String(month).padStart(2, '0')}` > today.slice(0, 7)) throw new HttpError(400, 'Payroll cannot be run for a future month');
    const run = await transaction(async client => {
      await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${orgId}`], client);
      const existing = await one<Row>('SELECT id,status FROM payroll_runs WHERE organization_id=$1 AND period_year=$2 AND period_month=$3 FOR UPDATE', [orgId, year, month], client);
      if (existing?.status === 'finalized') throw new HttpError(409, 'This month is finalized and locked');
      const built = await buildRunItems(orgId, year, month, client);
      if (!built.items.length) throw new HttpError(409, `No employees have a salary structure for ${periodLabel(year, month)}${built.skipped.length ? `: ${built.skipped.join(', ')}` : ''}`);
      const id = existing?.id ? String(existing.id) : (await one<{ id: string }>('INSERT INTO payroll_runs(organization_id,period_year,period_month,created_by) VALUES($1,$2,$3,$4) RETURNING id', [orgId, year, month, ctx.actor.id], client))!.id;
      if (existing) await sql(`UPDATE payroll_runs SET status='draft',approved_by=NULL,approved_at=NULL,created_by=$2 WHERE id=$1`, [id, ctx.actor.id], client);
      await persistItems(orgId, id, built, client);
      await audit(ctx.actor, existing ? 'payroll_recalculate' : 'payroll_create', 'payroll_runs', id, { year, month, employees: built.items.length }, client);
      return { id, skipped: built.skipped };
    });
    return json({ data: run }, 201);
  } },
  { method: 'GET', path: 'runs/:id', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const orgId = ctx.actor.organization_id; const run = await loadRun(orgId, ctx.params.id);
    const items = await sql(`SELECT i.id,i.employee_id,i.employee_snapshot,i.working_days::float AS working_days,i.lop_days::float AS lop_days,i.payable_days::float AS payable_days,i.basic::float AS basic,i.gross::float AS gross,i.lop_deduction::float AS lop_deduction,
      i.overtime_minutes,i.overtime_pay::float AS overtime_pay,i.bonus::float AS bonus,i.other_deductions::float AS other_deductions,i.statutory_deductions::float AS statutory_deductions,i.total_deductions::float AS total_deductions,i.net::float AS net,i.lines,i.warnings
      FROM payroll_items i WHERE i.run_id=$1 ORDER BY i.employee_snapshot->>'code'`, [run.id]);
    const unreviewed = await sql<{ code: string }>('SELECT code FROM payroll_components WHERE organization_id=$1 AND active=true AND reviewed_at IS NULL', [orgId]);
    return json({ data: { run, items, unreviewed_components: unreviewed.map(c => c.code) } });
  } },
  { method: 'POST', path: 'runs/:id/approve', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const orgId = ctx.actor.organization_id;
    await transaction(async client => {
      const run = await loadRun(orgId, ctx.params.id, client, true);
      if (run.status !== 'draft') throw new HttpError(409, `Only a draft run can be approved (this run is ${String(run.status)})`);
      if (run.created_by === ctx.actor.id && ctx.actor.role !== 'admin') throw new HttpError(403, 'A different payroll user must approve a run you generated');
      const [, to] = monthRange(Number(run.period_year), Number(run.period_month)); const settings = await getSettings(orgId, client);
      if (localDate(new Date(), settings.timezone) <= to) throw new HttpError(409, 'The pay period has not ended yet');
      const blocked = await one<{ n: number }>(`SELECT count(*)::int AS n FROM payroll_items WHERE run_id=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(warnings) w WHERE (w->>'blocking')::boolean)`, [run.id], client);
      if (blocked && blocked.n > 0) throw new HttpError(409, `${blocked.n} payslip(s) have unresolved blocking warnings. Fix attendance or adjustments and recalculate.`);
      const unreviewed = await sql<{ code: string }>('SELECT code FROM payroll_components WHERE organization_id=$1 AND active=true AND reviewed_at IS NULL', [orgId], client);
      if (unreviewed.length) throw new HttpError(409, `Statutory components awaiting legal review: ${unreviewed.map(c => c.code).join(', ')}. Review or deactivate them, then recalculate.`);
      await sql(`UPDATE payroll_runs SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1`, [run.id, ctx.actor.id], client);
      await audit(ctx.actor, 'payroll_approve', 'payroll_runs', String(run.id), {}, client);
    });
    return json({ ok: true });
  } },
  { method: 'POST', path: 'runs/:id/reopen', handle: async ctx => {
    need(ctx.actor, 'payroll.manage');
    const row = await one(`UPDATE payroll_runs SET status='draft',approved_by=NULL,approved_at=NULL WHERE id=$1 AND organization_id=$2 AND status='approved' RETURNING id`, [ctx.params.id, ctx.actor.organization_id]);
    if (!row) throw new HttpError(409, 'Only an approved run can be returned to draft');
    await audit(ctx.actor, 'payroll_reopen', 'payroll_runs', ctx.params.id, {});
    return json({ ok: true });
  } },
  { method: 'POST', path: 'runs/:id/finalize', handle: async ctx => {
    need(ctx.actor, 'payroll.manage'); const orgId = ctx.actor.organization_id;
    await transaction(async client => {
      await sql('SELECT pg_advisory_xact_lock(hashtext($1))', [`payroll:${orgId}`], client);
      const run = await loadRun(orgId, ctx.params.id, client, true);
      if (run.status !== 'approved') throw new HttpError(409, 'Only an approved run can be finalized');
      if (run.approved_by === ctx.actor.id && ctx.actor.role !== 'admin') throw new HttpError(403, 'A different payroll user must finalize a run you approved');
      // Re-verify that underlying data did not change after approval.
      const built = await buildRunItems(orgId, Number(run.period_year), Number(run.period_month), client);
      const stored = await sql<{ employee_id: string; net: string }>('SELECT employee_id,net::text AS net FROM payroll_items WHERE run_id=$1', [run.id], client);
      const same = built.items.length === stored.length && built.items.every(i => { const s = stored.find(x => x.employee_id === String(i.employee.id)); return s && Math.abs(Number(s.net) - i.result.net) < 0.005; });
      if (!same) throw new HttpError(409, 'Attendance, leave, overtime or salary data changed after approval. Recalculate and approve again.');
      await sql(`UPDATE payroll_runs SET status='finalized',finalized_by=$2,finalized_at=now() WHERE id=$1`, [run.id, ctx.actor.id], client);
      await audit(ctx.actor, 'payroll_finalize', 'payroll_runs', String(run.id), { total_net: run.total_net }, client);
    });
    return json({ ok: true });
  } },
  { method: 'GET', path: 'runs/:id/export', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const run = await loadRun(ctx.actor.organization_id, ctx.params.id);
    const items = await sql<Row>(`SELECT employee_snapshot,working_days::float AS wd,lop_days::float AS lop,basic::float AS basic,gross::float AS gross,lop_deduction::float AS lopd,overtime_pay::float AS ot,bonus::float AS bonus,other_deductions::float AS other,statutory_deductions::float AS stat,total_deductions::float AS ded,net::float AS net FROM payroll_items WHERE run_id=$1 ORDER BY employee_snapshot->>'code'`, [run.id]);
    await audit(ctx.actor, 'payroll_export', 'payroll_runs', String(run.id), {});
    return csvResponse(`payroll-${run.period_year}-${String(run.period_month).padStart(2, '0')}.csv`, ['Employee ID', 'Name', 'Department', 'Working Days', 'LOP Days', 'Basic', 'Gross', 'LOP Deduction', 'Overtime', 'Bonus', 'Other Deductions', 'Statutory', 'Total Deductions', 'Net Pay'],
      items.map(i => { const s = i.employee_snapshot as Row; return [s.code, s.name, s.department, i.wd, i.lop, i.basic, i.gross, i.lopd, i.ot, i.bonus, i.other, i.stat, i.ded, i.net]; }));
  } },

  // ---- Payslips ----
  { method: 'GET', path: 'payslips', handle: async ctx => {
    const own = await myEmployee(ctx.actor); const all = can(ctx.actor.role, 'payroll.view_all'); const orgId = ctx.actor.organization_id;
    const target = all ? (ctx.query.get('employee_id') || null) : String(own.id);
    const args: unknown[] = [orgId]; let filter = '';
    if (target) { args.push(v.uuid(target, 'Employee')); filter = `AND i.employee_id=$2`; }
    const data = await sql(`SELECT i.id,r.period_year,r.period_month,i.employee_snapshot,i.working_days::float AS working_days,i.lop_days::float AS lop_days,i.gross::float AS gross,i.total_deductions::float AS total_deductions,i.net::float AS net,i.lines,r.finalized_at
      FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.organization_id=$1 AND r.status='finalized' ${filter} ORDER BY r.period_year DESC,r.period_month DESC,i.employee_snapshot->>'code' LIMIT 300`, args);
    return json({ data });
  } },
  { method: 'GET', path: 'payslips/:id/pdf', handle: async ctx => {
    const orgId = ctx.actor.organization_id; const own = await myEmployee(ctx.actor);
    if (!UUID_RE.test(ctx.params.id)) throw new HttpError(404, 'Payslip not found');
    const item = await one<Row>(`SELECT i.*,r.period_year,r.period_month,o.name AS company FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id JOIN organizations o ON o.id=i.organization_id WHERE i.id=$1 AND i.organization_id=$2 AND r.status='finalized'`, [ctx.params.id, orgId]);
    if (!item || (item.employee_id !== own.id && !can(ctx.actor.role, 'payroll.view_all'))) throw new HttpError(404, 'Payslip not found');
    const settings = await getSettings(orgId); const snap = item.employee_snapshot as Row;
    await audit(ctx.actor, 'payslip_download', 'payroll_items', ctx.params.id, {});
    const pdf = payslipPdf({ company: String(item.company), period: periodLabel(Number(item.period_year), Number(item.period_month)), currency: settings.payroll_currency,
      employee: { code: String(snap.code), name: String(snap.name), department: snap.department as string, designation: snap.designation as string, joining_date: snap.joining_date as string, email: snap.email as string },
      working_days: Number(item.working_days), lop_days: Number(item.lop_days), payable_days: Number(item.payable_days), lines: item.lines as never, gross: Number(item.gross), total_deductions: Number(item.total_deductions), net: Number(item.net),
      generated_at: new Date().toISOString().slice(0, 10) });
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="payslip-${String(snap.code)}-${item.period_year}-${String(item.period_month).padStart(2, '0')}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } },

  // ---- Reports ----
  { method: 'GET', path: 'dashboard', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const orgId = ctx.actor.organization_id;
    const latest = await one<Row>(`SELECT period_year,period_month,status,employee_count,total_gross::float AS total_gross,total_net::float AS total_net FROM payroll_runs WHERE organization_id=$1 ORDER BY period_year DESC,period_month DESC LIMIT 1`, [orgId]);
    const open = await one<{ n: number }>(`SELECT count(*)::int AS n FROM payroll_runs WHERE organization_id=$1 AND status IN ('draft','approved')`, [orgId]);
    const missing = await one<{ n: number }>(`SELECT count(*)::int AS n FROM hr_employees e WHERE e.organization_id=$1 AND e.active=true AND NOT EXISTS (SELECT 1 FROM payroll_salary_structures s WHERE s.employee_id=e.id)`, [orgId]);
    return json({ data: { latest, open_runs: open?.n ?? 0, without_structure: missing?.n ?? 0 } });
  } },
  { method: 'GET', path: 'reports', handle: async ctx => {
    need(ctx.actor, 'payroll.view_all'); const year = Number(ctx.query.get('year') || new Date().getFullYear());
    const runs = await sql(`SELECT period_month,status,employee_count,total_gross::float AS total_gross,total_deductions::float AS total_deductions,total_overtime::float AS total_overtime,total_net::float AS total_net FROM payroll_runs WHERE organization_id=$1 AND period_year=$2 ORDER BY period_month`, [ctx.actor.organization_id, year]);
    const byDepartment = await sql(`SELECT i.employee_snapshot->>'department' AS department,count(*)::int AS payslips,sum(i.net)::float AS net FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE i.organization_id=$1 AND r.period_year=$2 AND r.status='finalized' GROUP BY 1 ORDER BY 3 DESC`, [ctx.actor.organization_id, year]);
    return json({ data: { runs, by_department: byDepartment, year } });
  } },
];

async function assertRunOpen(orgId: string, year: number, month: number) {
  const run = await one<Row>('SELECT status FROM payroll_runs WHERE organization_id=$1 AND period_year=$2 AND period_month=$3', [orgId, year, month]);
  if (run?.status === 'finalized') throw new HttpError(409, 'This month is finalized and locked');
  if (run?.status === 'approved') throw new HttpError(409, 'Return the approved run to draft before changing adjustments');
}
export type { Ctx };
