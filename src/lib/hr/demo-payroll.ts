'use client';

import { RuleError, can, toMinor } from './core';
import { localDate, monthRange } from './time';
import { v, has } from './validate';
import { computePayroll, validateComponents, validateStatutory, type PayrollResult, type Structure, type StatutoryRule } from './payroll';
import { payslipPdf } from './payslip';
import { toBase64 } from './pdf';
import { need, nowIso, registerDemoModule, table, uid, eid, type DemoCtx, type DemoRoute, type Row, type Store } from './demo-hr';
import { demoMonthDays, demoSettings } from './demo-core';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const label = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;
const find = (store: Store, name: string, id: string) => table(store, name).find(r => r.id === id);
const lopBasis = (store: Store) => (demoSettings(store).payroll_lop_basis ?? 'working_days') as 'working_days' | 'calendar_days' | 'fixed_30';
const currency = (store: Store) => String(demoSettings(store).payroll_currency ?? 'INR');

function structureAt(store: Store, employeeId: string, date: string): Row | null {
  return table(store, 'salary_structures').filter(s => s.employee_id === employeeId && String(s.effective_from) <= date).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] ?? null;
}

export function demoBuildItems(store: Store, year: number, month: number) {
  const [from, to] = monthRange(year, month); const settings = demoSettings(store); const today = localDate(new Date(), settings.timezone);
  const statutory = table(store, 'pay_components').filter(c => c.active && c.reviewed_at).map(c => ({ code: c.code, name: c.name, base: c.base, rate_percent: Number(c.rate_percent), base_cap: c.base_cap == null ? null : Number(c.base_cap) })) as unknown as StatutoryRule[];
  const rates = { weekday: Number(settings.overtime_weekday_multiplier), weekoff: Number(settings.overtime_weekoff_multiplier), holiday: Number(settings.overtime_holiday_multiplier) };
  const items: Array<{ employee: Row; result: PayrollResult }> = []; const skipped: string[] = [];
  for (const emp of table(store, 'employees')) {
    if ((emp.joining_date && String(emp.joining_date) > to) || (emp.exit_date && String(emp.exit_date) < from) || (!emp.active && !emp.exit_date)) continue;
    const s = structureAt(store, String(emp.id), to); if (!s) { skipped.push(`${String(emp.full_name)} (no salary structure)`); continue; }
    const days = demoMonthDays(store, emp, from, to);
    const adjustments = table(store, 'pay_adjustments').filter(a => a.employee_id === emp.id && a.period_year === year && a.period_month === month && !a.removed_at).map(a => ({ kind: a.kind, label: a.label, amount: Number(a.amount) })) as never;
    const overtime = settings.overtime_requires_approval
      ? table(store, 'overtime').filter(o => o.employee_id === emp.id && o.status === 'approved' && String(o.work_date) >= from && String(o.work_date) <= to && Number(o.approved_minutes) > 0).map(o => ({ minutes: Number(o.approved_minutes), day_type: o.day_type, multiplier: o.rate_multiplier == null ? null : Number(o.rate_multiplier) })) as never[]
      : days.filter(d => d.record && Number(d.record.overtime_minutes) > 0).map(d => ({ minutes: Number(d.record!.overtime_minutes), day_type: d.day_type })) as never[];
    const result = computePayroll({ structure: { basic: Number(s.basic), allowances: s.allowances, deductions: s.deductions } as Structure, statutory, days: days as never, overtime, adjustments, rates,
      lopBasis: lopBasis(store), standardDailyHours: Number(settings.standard_daily_hours), calendarDays: Number(to.slice(8)), monthComplete: today > to }, today);
    items.push({ employee: emp, result });
  }
  return { items, skipped, today };
}

function persist(store: Store, runId: string, built: ReturnType<typeof demoBuildItems>, run: Row) {
  store.pay_items = table(store, 'pay_items').filter(i => i.run_id !== runId);
  let gross = 0, ded = 0, ot = 0, net = 0;
  for (const { employee: e, result: r } of built.items) {
    gross += toMinor(r.gross); ded += toMinor(r.total_deductions); ot += toMinor(r.overtime_pay); net += toMinor(r.net);
    table(store, 'pay_items').push({ id: uid(), run_id: runId, employee_id: e.id, ...r, employee_snapshot: { code: e.employee_code, name: e.full_name, department: e.department, designation: e.designation, joining_date: e.joining_date, email: e.email } });
  }
  Object.assign(run, { employee_count: built.items.length, total_gross: gross / 100, total_deductions: ded / 100, total_overtime: ot / 100, total_net: net / 100 });
}

function createOrRecalculate(c: DemoCtx, year: number, month: number): Row {
  const today = localDate(new Date(), demoSettings(c.store).timezone);
  if (`${year}-${String(month).padStart(2, '0')}` > today.slice(0, 7)) throw new RuleError(400, 'Payroll cannot be run for a future month');
  const runs = table(c.store, 'pay_runs'); const existing = runs.find(r => r.period_year === year && r.period_month === month);
  if (existing?.status === 'finalized') throw new RuleError(409, 'This month is finalized and locked');
  const built = demoBuildItems(c.store, year, month);
  if (!built.items.length) throw new RuleError(409, `No employees have a salary structure for ${label(year, month)}${built.skipped.length ? `: ${built.skipped.join(', ')}` : ''}`);
  const run = existing ?? { id: uid(), period_year: year, period_month: month, status: 'draft', created_by: c.actor.id, created_at: nowIso() };
  if (!existing) runs.unshift(run); else Object.assign(run, { status: 'draft', approved_by: null, approved_at: null, created_by: c.actor.id });
  persist(c.store, String(run.id), built, run);
  return { id: run.id, skipped: built.skipped };
}

function assertRunOpen(store: Store, year: number, month: number) {
  const run = table(store, 'pay_runs').find(r => r.period_year === year && r.period_month === month);
  if (run?.status === 'finalized') throw new RuleError(409, 'This month is finalized and locked');
  if (run?.status === 'approved') throw new RuleError(409, 'Return the approved run to draft before changing adjustments');
}
const getRun = (store: Store, id: string): Row => { const r = find(store, 'pay_runs', id); if (!r) throw new RuleError(404, 'Payroll run not found'); return r; };
const unreviewed = (store: Store) => table(store, 'pay_components').filter(c => c.active && !c.reviewed_at).map(c => String(c.code));

function periodOf(src: Row | URLSearchParams) {
  const get = (k: string) => src instanceof URLSearchParams ? src.get(k) : src[k];
  const year = Number(get('year')); const month = Number(get('month'));
  if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) throw new RuleError(400, 'Year and month are required');
  return { year, month };
}
function pdfFor(c: DemoCtx, item: Row, run: Row) {
  const snap = item.employee_snapshot as Row;
  const bytes = payslipPdf({ company: 'SkillMint Global (Demo)', period: label(Number(run.period_year), Number(run.period_month)), simulated: true, currency: currency(c.store),
    employee: { code: String(snap.code), name: String(snap.name), department: snap.department as string, designation: snap.designation as string, joining_date: snap.joining_date as string, email: snap.email as string },
    working_days: Number(item.working_days), lop_days: Number(item.lop_days), payable_days: Number(item.payable_days), lines: item.lines as never, gross: Number(item.gross), total_deductions: Number(item.total_deductions), net: Number(item.net), generated_at: localDate(new Date()) });
  return { filename: `payslip-${String(snap.code)}-${run.period_year}-${String(run.period_month).padStart(2, '0')}.pdf`, pdf: toBase64(bytes) };
}

const routes: DemoRoute[] = [
  { method: 'GET', path: 'payroll/dashboard', handle: c => { need(c.actor, 'payroll.view_all'); const runs = [...table(c.store, 'pay_runs')].sort((a, b) => Number(b.period_year) * 100 + Number(b.period_month) - (Number(a.period_year) * 100 + Number(a.period_month)));
    const l = runs[0]; return { data: { latest: l ? { period_year: l.period_year, period_month: l.period_month, status: l.status, employee_count: l.employee_count, total_gross: l.total_gross, total_net: l.total_net } : null, open_runs: runs.filter(r => r.status !== 'finalized').length,
      without_structure: table(c.store, 'employees').filter(e => e.active && !table(c.store, 'salary_structures').some(s => s.employee_id === e.id)).length } }; } },
  { method: 'GET', path: 'payroll/structures/summary', handle: c => { need(c.actor, 'payroll.view_all'); const today = localDate(new Date());
    return { data: table(c.store, 'employees').filter(e => e.active).map(e => { const s = structureAt(c.store, String(e.id), today);
      return { employee_id: e.id, employee_code: e.employee_code, full_name: e.full_name, department: e.department, designation: e.designation, active: e.active, structure_id: s?.id ?? null, effective_from: s?.effective_from ?? null, basic: s ? Number(s.basic) : null, allowances: s?.allowances ?? null, deductions: s?.deductions ?? null }; }) }; } },
  { method: 'GET', path: 'payroll/structures', handle: c => { need(c.actor, 'payroll.view_all'); const id = c.query.get('employee_id');
    return { data: table(c.store, 'salary_structures').filter(s => s.employee_id === id).sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from))) }; } },
  { method: 'POST', path: 'payroll/structures', handle: c => { need(c.actor, 'payroll.manage'); const d = c.payload; const emp = find(c.store, 'employees', String(v.uuid(d.employee_id, 'Employee', true))); if (!emp) throw new RuleError(404, 'Employee not found');
    const from = v.date(d.effective_from, 'Effective date', true)!; const basic = v.num(d.basic, 'Basic salary', { max: 1e8, required: true })!;
    if (table(c.store, 'salary_structures').some(s => s.employee_id === emp.id && s.effective_from === from)) throw new RuleError(409, 'A salary structure already exists for that effective date');
    const row = { id: uid(), employee_id: emp.id, effective_from: from, basic, allowances: validateComponents(d.allowances, 'Allowance'), deductions: validateComponents(d.deductions, 'Deduction'), notes: v.str(d.notes, 'Notes', { max: 300 }), created_at: nowIso() };
    table(c.store, 'salary_structures').push(row); return { data: row }; } },

  { method: 'GET', path: 'payroll/components', handle: c => { need(c.actor, 'payroll.view_all'); return { data: table(c.store, 'pay_components') }; } },
  { method: 'POST', path: 'payroll/components', handle: c => { need(c.actor, 'payroll.manage'); const rule = validateStatutory(c.payload); const code = v.str(c.payload.code, 'Code', { required: true, max: 20 })!.toUpperCase();
    if (table(c.store, 'pay_components').some(x => x.code === code)) throw new RuleError(409, 'A component with this code already exists');
    const row = { id: uid(), code, name: v.str(c.payload.name, 'Name', { required: true, max: 100 }), ...rule, active: true, legal_note: null, reviewed_at: null, reviewed_by_name: null }; table(c.store, 'pay_components').push(row); return { data: row }; } },
  { method: 'PATCH', path: 'payroll/components/:id', handle: c => { need(c.actor, 'payroll.manage'); const cur = find(c.store, 'pay_components', c.params.id); if (!cur) throw new RuleError(404, 'Component not found'); const d = c.payload;
    const rule = validateStatutory({ base: has(d, 'base') ? d.base : cur.base, rate_percent: has(d, 'rate_percent') ? d.rate_percent : cur.rate_percent, base_cap: has(d, 'base_cap') ? d.base_cap : cur.base_cap });
    const changed = rule.rate_percent !== Number(cur.rate_percent) || rule.base !== cur.base || rule.base_cap !== (cur.base_cap == null ? null : Number(cur.base_cap));
    Object.assign(cur, rule, { active: has(d, 'active') ? v.bool(d.active) : cur.active, name: has(d, 'name') ? v.str(d.name, 'Name', { required: true, max: 100 }) : cur.name }, changed ? { reviewed_at: null, reviewed_by_name: null } : {}); return { data: cur }; } },
  { method: 'POST', path: 'payroll/components/:id/review', handle: c => { need(c.actor, 'payroll.manage'); const cur = find(c.store, 'pay_components', c.params.id); if (!cur) throw new RuleError(404, 'Component not found');
    return { data: Object.assign(cur, { legal_note: v.str(c.payload.legal_note, 'Legal reference / review note', { required: true, max: 500 }), reviewed_at: nowIso(), reviewed_by_name: c.actor.full_name }) }; } },
  { method: 'GET', path: 'payroll/settings', handle: c => { need(c.actor, 'payroll.view_all'); return { data: { payroll_lop_basis: lopBasis(c.store), payroll_currency: currency(c.store) } }; } },
  { method: 'PATCH', path: 'payroll/settings', handle: c => { need(c.actor, 'payroll.manage'); const s = demoSettings(c.store);
    s.payroll_lop_basis = v.oneOf(c.payload.payroll_lop_basis, 'Loss-of-pay basis', ['working_days', 'calendar_days', 'fixed_30'] as const, true); s.payroll_currency = v.str(c.payload.payroll_currency ?? 'INR', 'Currency', { max: 3 })!.toUpperCase();
    return { data: { payroll_lop_basis: s.payroll_lop_basis, payroll_currency: s.payroll_currency } }; } },

  { method: 'GET', path: 'payroll/adjustments', handle: c => { need(c.actor, 'payroll.view_all'); const { year, month } = periodOf(c.query);
    return { data: table(c.store, 'pay_adjustments').filter(a => a.period_year === year && a.period_month === month && !a.removed_at).map(a => ({ ...a, employee_name: find(c.store, 'employees', String(a.employee_id))?.full_name })) }; } },
  { method: 'POST', path: 'payroll/adjustments', handle: c => { need(c.actor, 'payroll.manage'); const d = c.payload; const { year, month } = periodOf(d); const emp = find(c.store, 'employees', String(v.uuid(d.employee_id, 'Employee', true))); if (!emp) throw new RuleError(404, 'Employee not found');
    assertRunOpen(c.store, year, month);
    const row = { id: uid(), employee_id: emp.id, period_year: year, period_month: month, kind: v.oneOf(d.kind, 'Type', ['bonus', 'deduction'] as const, true), label: v.str(d.label, 'Label', { required: true, max: 100 }), amount: v.num(d.amount, 'Amount', { min: 0.01, max: 1e8, required: true }), created_at: nowIso() };
    table(c.store, 'pay_adjustments').push(row); return { data: row }; } },
  { method: 'DELETE', path: 'payroll/adjustments/:id', handle: c => { need(c.actor, 'payroll.manage'); const a = find(c.store, 'pay_adjustments', c.params.id); if (!a || a.removed_at) throw new RuleError(404, 'Adjustment not found');
    assertRunOpen(c.store, Number(a.period_year), Number(a.period_month)); a.removed_at = nowIso(); return { ok: true }; } },

  { method: 'GET', path: 'payroll/runs', handle: c => { need(c.actor, 'payroll.view_all'); return { data: [...table(c.store, 'pay_runs')].sort((a, b) => Number(b.period_year) * 100 + Number(b.period_month) - (Number(a.period_year) * 100 + Number(a.period_month))) }; } },
  { method: 'POST', path: 'payroll/runs', handle: c => { need(c.actor, 'payroll.manage'); const { year, month } = periodOf(c.payload); return { data: createOrRecalculate(c, year, month) }; } },
  { method: 'GET', path: 'payroll/runs/:id', handle: c => { need(c.actor, 'payroll.view_all'); const run = getRun(c.store, c.params.id);
    return { data: { run, items: table(c.store, 'pay_items').filter(i => i.run_id === run.id).sort((a, b) => String((a.employee_snapshot as Row).code).localeCompare(String((b.employee_snapshot as Row).code))), unreviewed_components: unreviewed(c.store) } }; } },
  { method: 'POST', path: 'payroll/runs/:id/approve', handle: c => { need(c.actor, 'payroll.manage'); const run = getRun(c.store, c.params.id);
    if (run.status !== 'draft') throw new RuleError(409, `Only a draft run can be approved (this run is ${String(run.status)})`);
    if (run.created_by === c.actor.id && c.actor.role !== 'admin') throw new RuleError(403, 'A different payroll user must approve a run you generated');
    const [, to] = monthRange(Number(run.period_year), Number(run.period_month)); if (localDate(new Date(), demoSettings(c.store).timezone) <= to) throw new RuleError(409, 'The pay period has not ended yet');
    const blocked = table(c.store, 'pay_items').filter(i => i.run_id === run.id && (i.warnings as Array<{ blocking: boolean }>).some(w => w.blocking)).length;
    if (blocked) throw new RuleError(409, `${blocked} payslip(s) have unresolved blocking warnings. Fix attendance or adjustments and recalculate.`);
    const un = unreviewed(c.store); if (un.length) throw new RuleError(409, `Statutory components awaiting legal review: ${un.join(', ')}. Review or deactivate them, then recalculate.`);
    Object.assign(run, { status: 'approved', approved_by: c.actor.id, approved_at: nowIso() }); return { ok: true }; } },
  { method: 'POST', path: 'payroll/runs/:id/reopen', handle: c => { need(c.actor, 'payroll.manage'); const run = getRun(c.store, c.params.id); if (run.status !== 'approved') throw new RuleError(409, 'Only an approved run can be returned to draft');
    Object.assign(run, { status: 'draft', approved_by: null, approved_at: null }); return { ok: true }; } },
  { method: 'POST', path: 'payroll/runs/:id/finalize', handle: c => { need(c.actor, 'payroll.manage'); const run = getRun(c.store, c.params.id);
    if (run.status !== 'approved') throw new RuleError(409, 'Only an approved run can be finalized');
    if (run.approved_by === c.actor.id && c.actor.role !== 'admin') throw new RuleError(403, 'A different payroll user must finalize a run you approved');
    const built = demoBuildItems(c.store, Number(run.period_year), Number(run.period_month)); const stored = table(c.store, 'pay_items').filter(i => i.run_id === run.id);
    const same = built.items.length === stored.length && built.items.every(i => { const s = stored.find(x => x.employee_id === i.employee.id); return s && Math.abs(Number(s.net) - i.result.net) < 0.005; });
    if (!same) throw new RuleError(409, 'Attendance, leave, overtime or salary data changed after approval. Recalculate and approve again.');
    Object.assign(run, { status: 'finalized', finalized_by: c.actor.id, finalized_at: nowIso() }); return { ok: true }; } },
  { method: 'GET', path: 'payroll/runs/:id/export', handle: c => { need(c.actor, 'payroll.view_all'); const run = getRun(c.store, c.params.id); const cell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const rows = table(c.store, 'pay_items').filter(i => i.run_id === run.id).map(i => { const s = i.employee_snapshot as Row; return [s.code, s.name, s.department, i.working_days, i.lop_days, i.basic, i.gross, i.lop_deduction, i.overtime_pay, i.bonus, i.other_deductions, i.statutory_deductions, i.total_deductions, i.net].map(cell).join(','); });
    return { filename: `payroll-${run.period_year}-${String(run.period_month).padStart(2, '0')}-SIMULATED.csv`, csv: '\uFEFF' + [['Employee ID', 'Name', 'Department', 'Working Days', 'LOP Days', 'Basic', 'Gross', 'LOP Deduction', 'Overtime', 'Bonus', 'Other Deductions', 'Statutory', 'Total Deductions', 'Net Pay'].map(cell).join(','), ...rows].join('\r\n') }; } },

  { method: 'GET', path: 'payroll/payslips', handle: c => { const all = can(c.actor.role, 'payroll.view_all'); const target = all ? c.query.get('employee_id') : c.actor.employee_id;
    const finalized = new Map(table(c.store, 'pay_runs').filter(r => r.status === 'finalized').map(r => [r.id, r]));
    return { data: table(c.store, 'pay_items').filter(i => finalized.has(i.run_id) && (!target || i.employee_id === target)).map(i => { const r = finalized.get(i.run_id)!; return { ...i, period_year: r.period_year, period_month: r.period_month, finalized_at: r.finalized_at }; })
      .sort((a, b) => (Number(b.period_year) * 100 + Number(b.period_month)) - (Number(a.period_year) * 100 + Number(a.period_month))) }; } },
  { method: 'GET', path: 'payroll/payslips/:id/pdf', handle: c => { const item = find(c.store, 'pay_items', c.params.id); const run = item ? find(c.store, 'pay_runs', String(item.run_id)) : null;
    if (!item || !run || run.status !== 'finalized' || (item.employee_id !== c.actor.employee_id && !can(c.actor.role, 'payroll.view_all'))) throw new RuleError(404, 'Payslip not found'); return pdfFor(c, item, run); } },
  { method: 'GET', path: 'payroll/reports', handle: c => { need(c.actor, 'payroll.view_all'); const year = Number(c.query.get('year') || new Date().getFullYear());
    const runs = table(c.store, 'pay_runs').filter(r => r.period_year === year).map(r => ({ period_month: r.period_month, status: r.status, employee_count: r.employee_count, total_gross: r.total_gross, total_deductions: r.total_deductions, total_overtime: r.total_overtime, total_net: r.total_net })).sort((a, b) => Number(a.period_month) - Number(b.period_month));
    const fin = new Set(table(c.store, 'pay_runs').filter(r => r.status === 'finalized' && r.period_year === year).map(r => r.id)); const dep = new Map<string, { payslips: number; net: number }>();
    for (const i of table(c.store, 'pay_items')) if (fin.has(i.run_id)) { const k = String((i.employee_snapshot as Row).department ?? '—'); const e = dep.get(k) ?? { payslips: 0, net: 0 }; e.payslips++; e.net += Number(i.net); dep.set(k, e); }
    return { data: { runs, by_department: [...dep.entries()].map(([department, x]) => ({ department, ...x })).sort((a, b) => b.net - a.net), year } }; } },
];

function seed(store: Store) {
  const s = demoSettings(store); s.payroll_lop_basis = 'working_days'; s.payroll_currency = 'INR';
  const basics: Record<number, number> = { 1: 90000, 2: 62000, 3: 58000, 4: 48000, 5: 36000, 6: 30000 };
  for (const [n, basic] of Object.entries(basics)) table(store, 'salary_structures').push({ id: uid(), employee_id: eid(Number(n)), effective_from: '2025-01-01', basic, allowances: [{ name: 'House Rent Allowance', type: 'percent_basic', value: 40 }, { name: 'Transport Allowance', type: 'fixed', value: 1600 }], deductions: Number(n) === 6 ? [{ name: 'Canteen recovery', type: 'fixed', value: 500 }] : [], notes: 'Demo salary structure', created_at: nowIso() });
  table(store, 'pay_components').push({ id: uid(), code: 'DEMO-STAT', name: 'Sample statutory deduction (placeholder)', base: 'basic', rate_percent: 5, base_cap: null, active: true, legal_note: null, reviewed_at: null, reviewed_by_name: null });
  const today = localDate(new Date(), s.timezone); const [y, m] = today.split('-').map(Number);
  table(store, 'pay_adjustments').push({ id: uid(), employee_id: eid(3), period_year: y, period_month: m, kind: 'bonus', label: 'Quarterly performance bonus (demo)', amount: 5000, created_at: nowIso() });
  // One finalized run two months back so payslip history exists while recent months stay editable. The unreviewed placeholder rule is excluded by design.
  const back = new Date(Date.UTC(y, m - 3, 1)); const py = back.getUTCFullYear(); const pm = back.getUTCMonth() + 1;
  const fake = { store, actor: { id: '00000000-0000-4000-8000-000000000001' } } as unknown as DemoCtx;
  const built = demoBuildItems(store, py, pm); if (!built.items.length) return;
  const run: Row = { id: uid(), period_year: py, period_month: pm, status: 'finalized', created_by: fake.actor.id, created_at: nowIso(), approved_by: fake.actor.id, approved_at: nowIso(), finalized_by: fake.actor.id, finalized_at: nowIso() };
  table(store, 'pay_runs').push(run); persist(store, String(run.id), built, run);
}

registerDemoModule({ name: 'payroll', seed, routes });
