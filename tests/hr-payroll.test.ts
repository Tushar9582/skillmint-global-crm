import test from 'node:test';
import assert from 'node:assert/strict';
import { demoHrRequest } from '../src/lib/hr/demo-all';
import { eid } from '../src/lib/hr/demo-hr';
import { computePayroll, lopForDay, validateComponents, validateStatutory, type DayInput } from '../src/lib/hr/payroll';
import { buildPdf, textWidth } from '../src/lib/hr/pdf';
import { payslipPdf } from '../src/lib/hr/payslip';

const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});
const as = (role: string) => mem.set('skillmint-demo-role', role);
type R = Record<string, any>;
const call = (url: string, method = 'GET', body?: unknown) => demoHrRequest<R>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);

// June 2026: 30 days, 4 Sundays off -> 26 working days.
const june = Array.from({ length: 30 }, (_, i): DayInput => {
  const date = `2026-06-${String(i + 1).padStart(2, '0')}`; const off = new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
  return off ? { date, day_type: 'weekly_off', status: 'weekly_off', leave: null, record: null } : { date, day_type: 'working', status: 'present', leave: null, record: { status: 'present', punch_in: 'x' } };
});
const mark = (days: DayInput[], date: string, patch: Partial<DayInput>) => days.map(d => d.date === date ? { ...d, ...patch } : d);
const base = {
  structure: { basic: 30000, allowances: [{ name: 'HRA', type: 'percent_basic' as const, value: 40 }, { name: 'Transport', type: 'fixed' as const, value: 1600 }], deductions: [] },
  statutory: [], overtime: [], adjustments: [], rates: { weekday: 1.5, weekoff: 2, holiday: 2 }, lopBasis: 'working_days' as const, standardDailyHours: 8, calendarDays: 30, monthComplete: true,
};
const TODAY = '2026-07-05';

test('payroll arithmetic: LOP, overtime, bonus, deductions and statutory rules', () => {
  let days = mark(june, '2026-06-01', { status: 'absent', record: null }); days = mark(days, '2026-06-02', { status: 'absent', record: null });
  const r = computePayroll({ ...base, days, overtime: [{ minutes: 120, day_type: 'working' }],
    adjustments: [{ kind: 'bonus', label: 'Bonus', amount: 1000 }, { kind: 'deduction', label: 'Advance recovery', amount: 500 }],
    statutory: [{ code: 'X', name: 'Rule X', base: 'basic', rate_percent: 10, base_cap: null }] }, TODAY);
  assert.equal(r.working_days, 26); assert.equal(r.lop_days, 2); assert.equal(r.gross, 43600);
  assert.equal(r.lop_deduction, 3353.85); assert.equal(r.overtime_pay, 432.69); assert.equal(r.statutory_deductions, 2769.23);
  assert.equal(r.net, 38409.61); assert.equal(r.warnings.length, 0);
  assert.equal(r.total_deductions, 3353.85 + 500 + 2769.23);
});

test('statutory wage caps and calendar-day basis are configurable, not hardcoded', () => {
  const rule = { code: 'C', name: 'Capped', base: 'basic' as const, rate_percent: 12, base_cap: 15000 };
  assert.equal(computePayroll({ ...base, days: june, statutory: [rule] }, TODAY).statutory_deductions, 1800);
  assert.equal(computePayroll({ ...base, days: june, statutory: [{ ...rule, base_cap: null }] }, TODAY).statutory_deductions, 3600);
  const days = mark(june, '2026-06-01', { status: 'absent', record: null });
  assert.equal(computePayroll({ ...base, days, lopBasis: 'calendar_days' }, TODAY).lop_deduction, 1453.33);
  assert.equal(computePayroll({ ...base, days, lopBasis: 'fixed_30' }, TODAY).lop_deduction, 1453.33);
});

test('attendance, leave and half-day rules drive loss of pay', () => {
  const d = (patch: Partial<DayInput>): DayInput => ({ date: '2026-06-03', day_type: 'working', status: 'present', leave: null, record: null, ...patch });
  assert.equal(lopForDay(d({}), TODAY).lop, 1);
  assert.equal(lopForDay(d({ record: { status: 'half_day', punch_in: 'x' } }), TODAY).lop, 0.5);
  assert.equal(lopForDay(d({ leave: { half_day: false, paid: true } }), TODAY).lop, 0);
  assert.equal(lopForDay(d({ leave: { half_day: false, paid: false } }), TODAY).lop, 1);
  assert.equal(lopForDay(d({ leave: { half_day: true, paid: true } }), TODAY).lop, 0.5);
  assert.equal(lopForDay(d({ day_type: 'holiday' }), TODAY).lop, 0);
  assert.equal(lopForDay(d({ status: 'not_joined', day_type: 'working' }), TODAY).lop, 1);
  const missing = lopForDay(d({ record: { status: 'missing_punch', punch_in: 'x' } }), TODAY);
  assert.equal(missing.lop, 1); assert.match(String(missing.unresolved), /Missing/);
});

test('blocking warnings for unresolved attendance, open periods and negative pay', () => {
  const days = mark(june, '2026-06-03', { record: { status: 'missing_punch', punch_in: 'x' } });
  assert.ok(computePayroll({ ...base, days }, TODAY).warnings.some(w => w.code === 'UNRESOLVED_ATTENDANCE' && w.blocking));
  assert.ok(computePayroll({ ...base, days: june, monthComplete: false }, TODAY).warnings.some(w => w.code === 'MONTH_OPEN'));
  const neg = computePayroll({ ...base, days: june, adjustments: [{ kind: 'deduction', label: 'Recovery', amount: 90000 }] }, TODAY);
  assert.ok(neg.net < 0 && neg.warnings.some(w => w.code === 'NEGATIVE_NET'));
  const mid = june.map(x => x.date < '2026-06-16' && x.day_type === 'working' ? { ...x, status: 'not_joined', record: null } : x);
  assert.equal(computePayroll({ ...base, days: mid }, TODAY).lop_days, 13); // joined on the 16th: 13 working days before joining are unpaid
});

test('salary component and rule validation', () => {
  assert.throws(() => validateComponents([{ name: 'X', type: 'percent_basic', value: 150 }], 'Allowance'), /invalid amount/);
  assert.throws(() => validateComponents([{ name: '', type: 'fixed', value: 1 }], 'Allowance'), /needs a name/);
  assert.throws(() => validateStatutory({ rate_percent: 101, base: 'basic' }), /between 0 and 100/);
  assert.throws(() => validateStatutory({ rate_percent: 5, base: 'net' }), /Base must/);
  assert.deepEqual(validateStatutory({ rate_percent: 5, base: 'gross', base_cap: '' }), { rate_percent: 5, base: 'gross', base_cap: null });
});

test('generated PDFs are structurally valid', () => {
  const bytes = payslipPdf({ company: 'SkillMint Global', period: 'June 2026', simulated: true, employee: { code: 'EMP-0001', name: 'Test (User)', department: 'HR' }, working_days: 26, lop_days: 0, payable_days: 26,
    lines: [{ kind: 'earning', code: 'BASIC', label: 'Basic', amount: 1000 }, { kind: 'deduction', code: 'LOP', label: 'LOP \u20b9', amount: 10 }], gross: 1000, total_deductions: 10, net: 990, generated_at: '2026-07-01' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('NET PAY') && text.includes('SIMULATED'));
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const objects = (text.match(/^\d+ 0 obj/gm) ?? []).length;
  assert.equal(Number(/xref\n0 (\d+)/.exec(text)![1]), objects + 1);
  assert.ok(buildPdf([{ texts: [] }]).length > 100 && textWidth('1,000.00', 10) > 0);
});

test('payroll APIs are isolated from HR and recruiters; payslips are self-service only', async () => {
  as('hr_manager');
  await fails(call('/api/v1/payroll/runs'), /permission/);
  await fails(call('/api/v1/payroll/structures/summary'), /permission/);
  as('employee');
  await fails(call('/api/v1/payroll/structures/summary'), /permission/);
  await fails(call('/api/v1/payroll/components', 'POST', { code: 'X', name: 'x', base: 'basic', rate_percent: 1 }), /permission/);
  const mine = await call('/api/v1/payroll/payslips');
  assert.ok(mine.data.length >= 1 && mine.data.every((p: R) => p.employee_id === eid(3)), 'seeded last-month payslip is visible only to its owner');
  const pdf = await call(`/api/v1/payroll/payslips/${mine.data[0].id}/pdf`);
  assert.equal(Buffer.from(pdf.pdf, 'base64').subarray(0, 5).toString(), '%PDF-');
  as('finance');
  const all = await call('/api/v1/payroll/payslips');
  assert.ok(all.data.some((p: R) => p.employee_id !== eid(3)));
});

test('payroll run lifecycle: review gate, approver separation, finalization lock', async () => {
  as('finance');
  await fails(call('/api/v1/payroll/runs', 'POST', { year: 2099, month: 1 }), /future month/);
  const prev = (await call('/api/v1/payroll/runs')).data.find((r: R) => r.status === 'finalized');
  assert.ok(prev, 'seeded finalized run exists');
  await fails(call('/api/v1/payroll/runs', 'POST', { year: prev.period_year, month: prev.period_month }), /finalized and locked/);
  await fails(call('/api/v1/payroll/adjustments', 'POST', { employee_id: eid(3), year: prev.period_year, month: prev.period_month, kind: 'bonus', label: 'x', amount: 1 }), /locked/);

  // Use a historic month where only four employees had joined, so the result is deterministic.
  const created = await call('/api/v1/payroll/runs', 'POST', { year: 2025, month: 6 });
  const detail = await call(`/api/v1/payroll/runs/${created.data.id}`);
  assert.equal(detail.data.items.length, 4); assert.equal(detail.data.run.status, 'draft');
  assert.deepEqual(detail.data.unreviewed_components, ['DEMO-STAT']);
  await fails(call(`/api/v1/payroll/runs/${created.data.id}/approve`, 'POST'), /different payroll user/);
  as('admin');
  await fails(call(`/api/v1/payroll/runs/${created.data.id}/approve`, 'POST'), /awaiting legal review/);
  as('finance');
  const comp = (await call('/api/v1/payroll/components')).data[0];
  await fails(call(`/api/v1/payroll/components/${comp.id}/review`, 'POST', {}), /review note/);
  await call(`/api/v1/payroll/components/${comp.id}/review`, 'POST', { legal_note: 'Checked against current notification (test)' });
  await call('/api/v1/payroll/runs', 'POST', { year: 2025, month: 6 }); // recalculation picks up the reviewed rule
  as('admin');
  await call(`/api/v1/payroll/runs/${created.data.id}/approve`, 'POST');
  await fails(call(`/api/v1/payroll/runs/${created.data.id}/approve`, 'POST'), /Only a draft/);
  as('finance');
  await call(`/api/v1/payroll/runs/${created.data.id}/finalize`, 'POST');
  await fails(call('/api/v1/payroll/runs', 'POST', { year: 2025, month: 6 }), /finalized and locked/);
  as('hr_manager');
  await fails(call('/api/v1/hr/attendance/manual', 'POST', { employee_id: eid(3), work_date: '2025-06-10', in_time: '09:30', out_time: '18:30', reason: 'backfill' }), /locked/);
  await fails(call('/api/v1/hr/holidays', 'POST', { name: 'Late holiday', holiday_date: '2025-06-12' }), /locked/);
  as('finance');
  const report = (await call('/api/v1/payroll/reports?year=2025')).data;
  assert.equal(report.runs[0].status, 'finalized'); assert.equal(report.runs[0].employee_count, 4);
  const csv = await call(`/api/v1/payroll/runs/${created.data.id}/export`);
  assert.match(csv.csv, /Employee ID/);
});

test('changing a statutory rate withdraws its legal review; structures keep history', async () => {
  as('finance');
  const comp = (await call('/api/v1/payroll/components')).data[0];
  assert.ok(comp.reviewed_at);
  await call(`/api/v1/payroll/components/${comp.id}`, 'PATCH', { rate_percent: 6 });
  assert.equal((await call('/api/v1/payroll/components')).data[0].reviewed_at, null);
  await call('/api/v1/payroll/structures', 'POST', { employee_id: eid(3), effective_from: '2026-04-01', basic: 61000, allowances: [], deductions: [] });
  await fails(call('/api/v1/payroll/structures', 'POST', { employee_id: eid(3), effective_from: '2026-04-01', basic: 62000 }), /already exists/);
  assert.equal((await call(`/api/v1/payroll/structures?employee_id=${eid(3)}`)).data.length, 2);
});
