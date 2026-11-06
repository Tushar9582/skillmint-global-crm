import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { ORG, USER_IDS, actorFor, db, invoke, setupDb } from './helpers/pg';
import { hrRoutes } from '../src/lib/hr/routes';
import { payrollRoutes } from '../src/lib/hr/routes-payroll';
import { financeRoutes } from '../src/lib/hr/routes-finance';
import { addDays, localDate } from '../src/lib/hr/time';

const hr = (role: keyof typeof USER_IDS, method: string, path: string, body?: unknown) => invoke(hrRoutes, actorFor(role), method, path, body);
const pay = (role: keyof typeof USER_IDS, method: string, path: string, body?: unknown) => invoke(payrollRoutes, actorFor(role), method, path, body);
const fin = (role: keyof typeof USER_IDS, method: string, path: string, body?: unknown) => invoke(financeRoutes, actorFor(role), method, path, body);
const today = localDate(new Date());
let employeeIds: Record<string, string> = {};

before(async () => {
  await setupDb();
  await hr('admin', 'GET', 'employees'); // creates HR profiles for the four login accounts
  const rows = (await db().query<{ id: string; user_id: string }>(`SELECT id,user_id FROM hr_employees WHERE organization_id='${ORG}'`)).rows;
  for (const [role, uid] of Object.entries(USER_IDS)) employeeIds[role] = rows.find(r => r.user_id === uid)!.id;
  await db().exec(`UPDATE hr_employees SET joining_date='2025-01-01'`);
});

test('schema and every migration apply twice without errors', async () => {
  const tables = (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'hr\\_%' OR table_name LIKE 'payroll\\_%' OR table_name LIKE 'billing\\_%'`)).rows[0].n;
  assert.ok(tables >= 20, `expected the new module tables, found ${tables}`);
});

test('HR profiles exist for login accounts and employee management works against real SQL', async () => {
  const list = await hr('hr_manager', 'GET', 'employees');
  assert.equal(list.status, 200); assert.equal(list.body.data.length, 4); assert.match(list.body.data[0].employee_code, /^EMP-\d{4}$/);
  assert.equal((await hr('employee', 'GET', 'employees')).status, 403);
  const created = await hr('hr_manager', 'POST', 'employees', { full_name: 'Sql Person', email: 'sql.person@test.local', joining_date: '2025-02-03', department: 'Ops', manager_id: employeeIds.admin });
  assert.equal(created.status, 201, created.text); assert.match(created.body.data.employee_code, /^EMP-0005$/);
  assert.equal((await hr('hr_manager', 'POST', 'employees', { full_name: 'Dup', email: 'sql.person@test.local', joining_date: '2025-02-03' })).status, 409);
  assert.equal((await hr('hr_manager', 'POST', 'employees', { full_name: 'Login', email: 'l@test.local', joining_date: '2025-02-03', create_login: true, temporary_password: 'x'.repeat(12) })).status, 403);
  const login = await hr('admin', 'POST', 'employees', { full_name: 'Login User', email: 'login.user@test.local', joining_date: '2025-02-03', create_login: true, login_role: 'finance', temporary_password: 'a-long-temp-password' });
  assert.equal(login.status, 201, login.text);
  assert.equal((await db().query(`SELECT role FROM users WHERE email='login.user@test.local'`)).rows[0] && ((await db().query<{ role: string }>(`SELECT role FROM users WHERE email='login.user@test.local'`)).rows[0].role), 'finance');
  assert.equal((await hr('hr_manager', 'PATCH', `employees/${created.body.data.id}`, { manager_id: created.body.data.id })).status, 400);
  const off = await hr('hr_manager', 'PATCH', `employees/${created.body.data.id}`, { employment_status: 'resigned', department: 'Ops 2' });
  assert.equal(off.status, 200, off.text); assert.equal(off.body.data.active, false);
  const detail = await hr('hr_manager', 'GET', `employees/${created.body.data.id}`);
  assert.ok(detail.body.data.history.some((h: any) => h.event_type === 'department_change'));
  assert.equal((await hr('employee', 'GET', `employees/${employeeIds.employee}`)).status, 200, 'own profile');
  assert.equal((await hr('employee', 'GET', `employees/${employeeIds.admin}`)).status, 403, 'someone else');
  assert.equal((await hr('hr_manager', 'PATCH', `employees/${employeeIds.hr_manager}`, { employment_status: 'inactive' })).status, 400, 'cannot deactivate self');
});

test('holidays, shifts and shift assignment history', async () => {
  const year = new Date().getFullYear();
  assert.equal((await hr('hr_manager', 'POST', 'holidays', { name: 'Test Holiday', holiday_date: `${year}-12-25`, holiday_type: 'public' })).status, 201);
  assert.equal((await hr('hr_manager', 'POST', 'holidays', { name: 'Test Holiday', holiday_date: `${year}-12-25` })).status, 409);
  assert.equal((await hr('employee', 'GET', `holidays?year=${year}`)).body.data.length, 1);
  const shift = await hr('hr_manager', 'POST', 'shifts', { name: 'Night', kind: 'night', start_time: '22:00', end_time: '06:00', break_minutes: 30, grace_minutes: 10, weekly_off: [0], working_days: [1, 2, 3, 4, 5, 6] });
  assert.equal(shift.status, 201, shift.text);
  assert.equal((await hr('hr_manager', 'POST', 'shifts', { name: 'Same', start_time: '09:00', end_time: '09:00' })).status, 400);
  const general = await hr('hr_manager', 'POST', 'shifts', { name: 'General', start_time: '09:00', end_time: '18:00', break_minutes: 60, grace_minutes: 15 });
  const assign = await hr('hr_manager', 'POST', 'shifts/assign', { shift_id: general.body.data.id, employee_ids: Object.values(employeeIds), effective_from: '2025-01-01' });
  assert.equal(assign.body.data.assigned, 4, assign.text);
  const change = await hr('hr_manager', 'POST', 'shifts/assign', { shift_id: shift.body.data.id, employee_ids: [employeeIds.employee], effective_from: addDays(today, 5), reason: 'Rotation' });
  assert.equal(change.body.data.assigned, 1);
  const history = await hr('hr_manager', 'GET', `shifts/history?employee_id=${employeeIds.employee}`);
  assert.equal(history.body.data.length, 2); assert.equal(history.body.data[1].effective_to, addDays(today, 4));
  assert.equal((await hr('hr_manager', 'PATCH', `shifts/${shift.body.data.id}`, { active: false })).status, 409);
  const roster = await hr('hr_manager', 'GET', 'shifts/roster');
  assert.ok(roster.body.data.filter((r: any) => Object.values(employeeIds).includes(r.employee_id)).every((r: any) => r.shift_name));
  assert.equal((await hr('employee', 'GET', 'shifts')).status, 403);
});

test('attendance: server punches, one record per day, corrections with audit, calendar and export', async () => {
  const me = await hr('employee', 'GET', 'attendance/me'); assert.equal(me.status, 200, me.text); assert.equal(me.body.data.punched_in, false);
  const inn = await hr('employee', 'POST', 'attendance/punch', { action: 'in' }); assert.equal(inn.status, 201, inn.text);
  assert.equal((await hr('employee', 'POST', 'attendance/punch', { action: 'in' })).status, 409);
  assert.equal((await hr('employee', 'GET', 'attendance/me')).body.data.punched_in, true);
  const out = await hr('employee', 'POST', 'attendance/punch', { action: 'out' }); assert.equal(out.status, 201, out.text);
  assert.equal((await hr('employee', 'POST', 'attendance/punch', { action: 'in' })).status, 409);
  const own = await hr('employee', 'GET', 'attendance'); assert.equal(own.body.data.length, 1);
  assert.equal((await hr('employee', 'GET', `attendance?employee_id=${employeeIds.admin}`)).body.data.length, 1, 'employees only ever see their own rows');
  const day = addDays(today, -3);
  const manual = await hr('hr_manager', 'POST', 'attendance/manual', { employee_id: employeeIds.employee, work_date: day, in_time: '09:00', out_time: '21:30', reason: 'Backfill after outage' });
  assert.equal(manual.status, 201, manual.text); assert.ok(manual.body.data.overtime_minutes > 0);
  assert.equal((await hr('employee', 'POST', 'attendance/manual', { employee_id: employeeIds.employee, work_date: day, in_time: '09:00', reason: 'x' })).status, 403);
  const fixed = await hr('hr_manager', 'PATCH', `attendance/${manual.body.data.id}`, { in_time: '09:05', out_time: '21:30', reason: 'Corrected in time' });
  assert.equal(fixed.status, 200, fixed.text);
  const log = await hr('hr_manager', 'GET', `attendance/${manual.body.data.id}/corrections`); assert.equal(log.body.data.length, 2);
  assert.equal((await hr('hr_manager', 'GET', 'attendance/today')).body.summary.total, 5);
  const cal = await hr('hr_manager', 'GET', `attendance/calendar?employee_id=${employeeIds.employee}&month=${day.slice(0, 7)}`);
  assert.equal(cal.body.data.find((d: any) => d.date === day).status, 'present');
  const csv = await hr('hr_manager', 'GET', `attendance/export?month=${day.slice(0, 7)}`); assert.match(csv.text, /Employee ID/);
});

test('leave: balances, overlap rules, approval workflow and calendar against real SQL', async () => {
  const types = (await hr('employee', 'GET', 'leave/types')).body.data; const cl = types.find((t: any) => t.code === 'CL');
  const monday = (() => { let d = addDays(today, 40); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return d; })();
  const req = await hr('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: monday, end_date: addDays(monday, 4), reason: 'Trip' });
  assert.equal(req.status, 201, req.text);
  assert.equal((await hr('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: addDays(monday, 2), half_day: true, reason: 'x' })).status, 409);
  assert.equal((await hr('employee', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: addDays(monday, 7), end_date: addDays(monday, 25), reason: 'long' })).status, 409);
  const bal = (await hr('employee', 'GET', 'leave/balances')).body.data.find((b: any) => b.code === 'CL'); assert.equal(bal.pending, 5); assert.equal(bal.remaining, 7);
  assert.equal((await hr('employee', 'POST', `leave/requests/${req.body.data.id}/decision`, { decision: 'approved' })).status, 403);
  assert.equal((await hr('hr_manager', 'POST', `leave/requests/${req.body.data.id}/decision`, { decision: 'approved' })).status, 200);
  assert.equal((await hr('hr_manager', 'POST', `leave/requests/${req.body.data.id}/decision`, { decision: 'rejected' })).status, 409);
  const cal = await hr('hr_manager', 'GET', `attendance/calendar?employee_id=${employeeIds.employee}&month=${monday.slice(0, 7)}`);
  assert.equal(cal.body.data.find((d: any) => d.date === monday).status, 'leave');
  assert.equal((await hr('hr_manager', 'GET', `leave/calendar?month=${monday.slice(0, 7)}`)).body.data.length, 1);
  const own = await hr('hr_manager', 'POST', 'leave/requests', { leave_type_id: cl.id, start_date: addDays(monday, 21), reason: 'Mine' });
  assert.equal((await hr('hr_manager', 'POST', `leave/requests/${own.body.data.id}/decision`, { decision: 'approved' })).status, 403, 'self approval blocked');
  assert.equal((await hr('admin', 'POST', `leave/requests/${own.body.data.id}/decision`, { decision: 'approved' })).status, 200);
  const adj = await hr('hr_manager', 'POST', 'leave/balances', { employee_id: employeeIds.employee, leave_type_id: cl.id, year: Number(monday.slice(0, 4)), adjustment: 2, reason: 'Carry forward' });
  assert.equal(adj.status, 200, adj.text);
  assert.equal((await hr('employee', 'POST', `leave/requests/${req.body.data.id}/cancel`)).status, 200);
});

test('overtime: request from calculated attendance, approval limits, report', async () => {
  const day = addDays(today, -3);
  const eligible = await hr('employee', 'GET', 'overtime/eligible'); assert.equal(eligible.body.data.length, 1, eligible.text);
  const calc = eligible.body.data[0].calculated_minutes;
  assert.equal((await hr('employee', 'POST', 'overtime', { work_date: day, requested_minutes: calc + 1, reason: 'x' })).status, 400);
  const created = await hr('employee', 'POST', 'overtime', { work_date: day, requested_minutes: 90, reason: 'Release night' }); assert.equal(created.status, 201, created.text);
  assert.equal((await hr('employee', 'POST', 'overtime', { work_date: day, reason: 'again' })).status, 409);
  assert.equal((await hr('hr_manager', 'POST', `overtime/${created.body.data.id}/decision`, { decision: 'approved', approved_minutes: 120 })).status, 400);
  const done = await hr('hr_manager', 'POST', `overtime/${created.body.data.id}/decision`, { decision: 'approved', approved_minutes: 60 }); assert.equal(done.status, 200, done.text);
  const report = await hr('hr_manager', 'GET', `overtime/report?month=${day.slice(0, 7)}`); assert.equal(report.body.data.find((r: any) => r.approved_hours === 1) !== undefined, true, report.text);
  assert.equal((await hr('finance', 'PATCH', 'settings', { overtime_weekday_multiplier: 2 })).status, 403);
  assert.equal((await hr('hr_manager', 'PATCH', 'settings', { overtime_weekday_multiplier: 1.75, full_day_ratio: 0.8, half_day_ratio: 0.4 })).status, 200);
  assert.equal((await hr('hr_manager', 'PATCH', 'settings', { half_day_ratio: 0.95 })).status, 400);
});

test('payroll end to end: structures, review gate, separation of duties, finalization and DB-level immutability', async () => {
  assert.equal((await pay('hr_manager', 'GET', 'runs')).status, 403);
  assert.equal((await pay('employee', 'GET', 'structures/summary')).status, 403);
  for (const role of ['admin', 'hr_manager', 'employee', 'finance'] as const)
    assert.equal((await pay('finance', 'POST', 'structures', { employee_id: employeeIds[role], effective_from: '2025-01-01', basic: 30000, allowances: [{ name: 'HRA', type: 'percent_basic', value: 40 }], deductions: [] })).status, 201);
  assert.equal((await pay('finance', 'POST', 'structures', { employee_id: employeeIds.admin, effective_from: '2025-01-01', basic: 1 })).status, 409);
  const comp = await pay('finance', 'POST', 'components', { code: 'TEST', name: 'Test rule', base: 'basic', rate_percent: 5 }); assert.equal(comp.status, 201, comp.text);
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 2); const year = d.getUTCFullYear(); const month = d.getUTCMonth() + 1;
  assert.equal((await pay('finance', 'POST', 'runs', { year: 2099, month: 1 })).status, 400);
  const run = await pay('finance', 'POST', 'runs', { year, month }); assert.equal(run.status, 201, run.text);
  const detail = await pay('finance', 'GET', `runs/${run.body.data.id}`); assert.equal(detail.body.data.items.length, 4, detail.text); assert.deepEqual(detail.body.data.unreviewed_components, ['TEST']);
  assert.equal((await pay('finance', 'POST', `runs/${run.body.data.id}/approve`)).status, 403, 'creator cannot approve');
  assert.equal((await pay('admin', 'POST', `runs/${run.body.data.id}/approve`)).status, 409, 'unreviewed statutory component blocks approval');
  assert.equal((await pay('finance', 'POST', `components/${comp.body.data.id}/review`, {})).status, 400);
  assert.equal((await pay('finance', 'POST', `components/${comp.body.data.id}/review`, { legal_note: 'Checked against current notification' })).status, 200);
  assert.equal((await pay('finance', 'POST', 'runs', { year, month })).status, 201, 'recalculation');
  assert.equal((await pay('admin', 'POST', `runs/${run.body.data.id}/approve`)).status, 200);
  assert.equal((await pay('finance', 'POST', `runs/${run.body.data.id}/finalize`)).status, 200);
  assert.equal((await pay('finance', 'POST', 'runs', { year, month })).status, 409, 'finalized month is locked');
  const trigger = await db().query(`UPDATE payroll_items SET net=1 WHERE run_id='${run.body.data.id}'`).then(() => 'changed', e => String(e.message));
  assert.match(trigger, /Finalized payroll items cannot be changed/);
  const trigger2 = await db().query(`UPDATE payroll_runs SET status='draft' WHERE id='${run.body.data.id}'`).then(() => 'changed', e => String(e.message));
  assert.match(trigger2, /Finalized payroll runs cannot be changed/);
  assert.equal((await hr('hr_manager', 'POST', 'attendance/manual', { employee_id: employeeIds.employee, work_date: `${year}-${String(month).padStart(2, '0')}-10`, in_time: '09:00', out_time: '18:00', reason: 'late' })).status, 409);
  assert.equal((await hr('hr_manager', 'POST', 'holidays', { name: 'Locked', holiday_date: `${year}-${String(month).padStart(2, '0')}-12` })).status, 409);
  const mine = await pay('employee', 'GET', 'payslips'); assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.data[0].employee_snapshot.code.startsWith('EMP-'), true);
  const pdf = await pay('employee', 'GET', `payslips/${mine.body.data[0].id}/pdf`); assert.ok(pdf.text.startsWith('%PDF-'));
  const others = (await pay('finance', 'GET', 'payslips')).body.data.find((p: any) => p.id !== mine.body.data[0].id);
  assert.equal((await pay('employee', 'GET', `payslips/${others.id}/pdf`)).status, 404, 'cannot read someone else\'s payslip');
  assert.match((await pay('finance', 'GET', `runs/${run.body.data.id}/export`)).text, /Employee ID/);
  assert.equal((await pay('finance', 'GET', `reports?year=${year}`)).body.data.runs[0].status, 'finalized');
});

test('billing end to end: gapless numbering, manual payments only, voids and reconciliation', async () => {
  await db().exec(`INSERT INTO clients(id,organization_id,company_name,contact_name,city) VALUES('00000000-0000-4000-8000-0000000000c1','${ORG}','Acme Corp','Pat','Pune')`);
  const cid = '00000000-0000-4000-8000-0000000000c1';
  assert.equal((await fin('employee', 'GET', 'invoices')).status, 403); assert.equal((await fin('hr_manager', 'GET', 'invoices')).status, 403);
  const tax = await fin('finance', 'POST', 'tax-rates', { name: 'Test tax', rate_percent: 10 }); assert.equal(tax.status, 201, tax.text);
  assert.equal((await fin('finance', 'POST', 'tax-rates', { name: 'Test tax', rate_percent: 5 })).status, 409);
  const inv = await fin('finance', 'POST', 'invoices', { client_id: cid, service_description: 'Placement', line_items: [{ description: 'Fee', quantity: 2, unit_price: 500 }], tax_rate_ids: [tax.body.data.id] }); assert.equal(inv.status, 201, inv.text);
  assert.equal((await fin('finance', 'POST', `invoices/${inv.body.data.id}/payments`, { amount: 10, paid_on: today, method: 'cash' })).status, 409);
  const issued = await fin('finance', 'POST', `invoices/${inv.body.data.id}/send`); assert.equal(issued.status, 200, issued.text);
  assert.match(issued.body.data.number, /^INV-\d{4}-0001$/);
  const inv2 = await fin('finance', 'POST', 'invoices', { client_id: cid, service_description: 'Second', line_items: [{ description: 'Fee', quantity: 1, unit_price: 100 }] });
  assert.match((await fin('finance', 'POST', `invoices/${inv2.body.data.id}/send`)).body.data.number, /0002$/);
  assert.equal((await fin('finance', 'PATCH', `invoices/${inv.body.data.id}`, { notes: 'x' })).status, 409);
  const p = (body: unknown) => fin('finance', 'POST', `invoices/${inv.body.data.id}/payments`, body);
  assert.equal((await p({ amount: 1100.01, paid_on: today, method: 'cash' })).status, 409);
  assert.equal((await p({ amount: 10, paid_on: today, method: 'cash', source: 'gateway' })).status, 400);
  const first = await p({ amount: 400, paid_on: today, method: 'bank_transfer', reference: 'UTR' }); assert.equal(first.status, 201, first.text); assert.equal(first.body.data.status, 'partially_paid');
  const second = await p({ amount: 700, paid_on: today, method: 'upi' }); assert.equal(second.body.data.status, 'paid');
  assert.equal((await fin('finance', 'POST', `payments/${second.body.data.id}/void`, { reason: 'Bounced' })).status, 200);
  let detail = await fin('finance', 'GET', `invoices/${inv.body.data.id}`); assert.equal(detail.body.data.invoice.status, 'partially_paid'); assert.equal(detail.body.data.invoice.balance, 700);
  assert.equal((await fin('finance', 'POST', `invoices/${inv.body.data.id}/cancel`, { reason: 'no' })).status, 409);
  const list = await fin('finance', 'GET', 'invoices'); const open = list.body.data.filter((i: any) => ['sent', 'partially_paid', 'overdue'].includes(i.status));
  const report = (await fin('finance', 'GET', 'reports')).body.data; assert.equal(report.summary.outstanding, Math.round(open.reduce((s: number, i: any) => s + i.balance * 100, 0)) / 100);
  assert.equal((await fin('finance', 'GET', 'clients')).body.data[0].outstanding, report.summary.outstanding);
  const pdf = await fin('finance', 'GET', `invoices/${inv.body.data.id}/pdf`); assert.ok(pdf.text.startsWith('%PDF-'));
  assert.match((await fin('finance', 'GET', 'export')).text, /Invoice Number/);
  const dup = await db().query(`INSERT INTO billing_invoices(organization_id,client_id,invoice_number,invoice_date,due_date,service_description,status) VALUES('${ORG}','${cid}','${issued.body.data.number}','${today}','${today}','x','sent')`).then(() => 'inserted', e => String(e.message));
  assert.match(dup, /duplicate key|unique/i);
  const gateway = await db().query(`INSERT INTO billing_payments(organization_id,invoice_id,amount,paid_on,method,source) VALUES('${ORG}','${inv.body.data.id}',1,'${today}','cash','gateway')`).then(() => 'inserted', e => String(e.message));
  assert.match(gateway, /check constraint|violates/i, 'gateway rows need a gateway transaction id');
  detail = await fin('finance', 'GET', `invoices/${inv.body.data.id}`);
  assert.deepEqual(detail.body.data.payments.map((x: any) => [x.source, Boolean(x.voided_at)]), [['manual', false], ['manual', true]]);
});
