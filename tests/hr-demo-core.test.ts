import test from 'node:test';
import assert from 'node:assert/strict';
import { demoHrRequest } from '../src/lib/hr/demo-all';
import { eid } from '../src/lib/hr/demo-hr';

// Minimal browser globals so the demo store can run under Node (read lazily at call time).
const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});

const as = (role: string) => mem.set('skillmint-demo-role', role);
type R = Record<string, any>;
const call = (url: string, method = 'GET', body?: unknown) => demoHrRequest<R>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const fails = async (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, pattern);

test('seeded demo data is separate and role gated', async () => {
  as('admin');
  const list = await call('/api/v1/hr/employees');
  assert.equal(list.data.length, 6);
  assert.ok(list.departments.includes('Human Resources'));
  as('employee');
  await fails(call('/api/v1/hr/employees'), /permission/);
  as('finance');
  await fails(call('/api/v1/hr/attendance/today'), /permission/);
  as('hr_manager');
  assert.equal((await call('/api/v1/hr/attendance/today')).summary.total, 6);
});

test('employee punches in and out once per day with server time', async () => {
  as('employee');
  const before = await call('/api/v1/hr/attendance/me');
  assert.equal(before.data.punched_in, false);
  await call('/api/v1/hr/attendance/punch', 'POST', { action: 'in' });
  await fails(call('/api/v1/hr/attendance/punch', 'POST', { action: 'in' }), /already punched in/);
  assert.equal((await call('/api/v1/hr/attendance/me')).data.punched_in, true);
  await call('/api/v1/hr/attendance/punch', 'POST', { action: 'out' });
  await fails(call('/api/v1/hr/attendance/punch', 'POST', { action: 'in' }), /already recorded/);
  await fails(call('/api/v1/hr/attendance/punch', 'POST', { action: 'out' }), /No active punch-in/);
  const mine = await call('/api/v1/hr/attendance');
  assert.ok(mine.data.every((r: R) => r.employee_id === eid(3)), 'employees only see their own attendance');
});

test('HR corrects attendance with an audit trail; employees cannot', async () => {
  as('hr_manager');
  const list = await call(`/api/v1/hr/attendance?employee_id=${eid(3)}&issue=missing`);
  assert.ok(list.data.length >= 1);
  const target = list.data[0];
  await fails(call(`/api/v1/hr/attendance/${target.id}`, 'PATCH', { in_time: '09:30', out_time: '18:30' }), /reason/i);
  const fixed = await call(`/api/v1/hr/attendance/${target.id}`, 'PATCH', { in_time: '09:30', out_time: '18:30', reason: 'Forgot to punch out' });
  assert.equal(fixed.data.status, 'present');
  assert.equal(fixed.data.source, 'correction');
  const history = await call(`/api/v1/hr/attendance/${target.id}/corrections`);
  assert.equal(history.data[0].reason, 'Forgot to punch out');
  as('employee');
  await fails(call(`/api/v1/hr/attendance/${target.id}`, 'PATCH', { in_time: '09:30', reason: 'x' }), /permission/);
});

test('holidays: HR manages, everyone reads, duplicates are rejected', async () => {
  const year = new Date().getFullYear();
  as('hr_manager');
  await call('/api/v1/hr/holidays', 'POST', { name: 'Test Day', holiday_date: `${year}-05-05`, holiday_type: 'company' });
  await fails(call('/api/v1/hr/holidays', 'POST', { name: 'Test Day', holiday_date: `${year}-05-05` }), /already exists/);
  await fails(call('/api/v1/hr/holidays', 'POST', { name: 'Bad', holiday_date: '2026-02-30' }), /valid date/);
  as('employee');
  assert.ok((await call(`/api/v1/hr/holidays?year=${year}`)).data.some((h: R) => h.name === 'Test Day'));
  await fails(call('/api/v1/hr/holidays', 'POST', { name: 'Nope', holiday_date: `${year}-06-06` }), /permission/);
});

test('employee profiles: validation, reporting-line loops and self-deactivation', async () => {
  as('hr_manager');
  const created = await call('/api/v1/hr/employees', 'POST', { full_name: 'Test Person', email: 'test.person@skillmint.local', joining_date: '2026-01-05', department: 'Recruitment' });
  assert.match(created.data.employee_code, /^EMP-\d{4}$/);
  await fails(call('/api/v1/hr/employees', 'POST', { full_name: 'Dup', email: 'test.person@skillmint.local', joining_date: '2026-01-05' }), /already exists/);
  await fails(call('/api/v1/hr/employees', 'POST', { full_name: 'Login', email: 'l@x.com', joining_date: '2026-01-05', create_login: true, temporary_password: 'x'.repeat(12) }), /Administrator/);
  await call(`/api/v1/hr/employees/${created.data.id}`, 'PATCH', { manager_id: eid(3) });
  await fails(call(`/api/v1/hr/employees/${eid(3)}`, 'PATCH', { manager_id: created.data.id }), /loop/);
  await fails(call(`/api/v1/hr/employees/${eid(2)}`, 'PATCH', { employment_status: 'inactive' }), /your own account/);
  await call(`/api/v1/hr/employees/${created.data.id}`, 'PATCH', { employment_status: 'resigned' });
  const detail = await call(`/api/v1/hr/employees/${created.data.id}`);
  assert.equal(detail.data.employee.active, false);
  assert.ok(detail.data.history.some((h: R) => h.event_type === 'employment_status_change'));
});
