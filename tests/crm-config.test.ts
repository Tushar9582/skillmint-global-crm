import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { actorFor, db, invoke, setupDb } from './helpers/pg';
import { configRoutes } from '../src/lib/hr/routes-config';
import { createRecord, updateRecord, listRecords } from '../src/lib/records';
import { activeValues } from '../src/lib/crm-config';
import { applyOptions, defaultOptions, toValue, validateCustomValues, validateFieldDefinition, type CustomFieldDef } from '../src/lib/hr/crm-config';
import { CATALOG } from '../src/lib/catalog';

const cfg = (role: 'admin' | 'employee' | 'hr_manager' | 'finance', method: string, path: string, body?: unknown) => invoke(configRoutes, actorFor(role), method, path, body);
const admin = actorFor('admin'); const employee = actorFor('employee');
const rejects = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));

before(async () => { await setupDb(); });

test('pure helpers: defaults come from the catalog and values are normalised', () => {
  assert.deepEqual(defaultOptions('company_lead_stage').filter(o => o.is_system).map(o => o.value), ['new', 'converted']);
  assert.ok(defaultOptions('followup_type').some(o => o.value === 'whatsapp'));
  assert.equal(toValue('  Site Visit! '), 'site_visit');
  assert.throws(() => toValue('1abc'), /start with a letter/);
  const def = applyOptions(CATALOG.candidates, 'candidates', { candidate_stage: ['new', 'vip'] }, { stage: 'legacy' });
  assert.deepEqual(def.stages, ['new', 'vip']); assert.deepEqual(def.fields.find(f => f.name === 'stage')!.options, ['new', 'vip', 'legacy']);
  assert.throws(() => validateFieldDefinition({ entity: 'candidates', label: 'Full Name', field_key: 'full_name', field_type: 'text' }, true), /built-in/);
  const defs: CustomFieldDef[] = [{ field_key: 'budget', label: 'Budget', field_type: 'number', options: [], required: true, active: true }, { field_key: 'tier', label: 'Tier', field_type: 'select', options: ['gold', 'silver'], required: false, active: true }];
  assert.deepEqual(validateCustomValues(defs, { budget: '500', tier: 'gold' }, {}, true), { budget: 500, tier: 'gold' });
  assert.throws(() => validateCustomValues(defs, {}, {}, true), /Budget is required/);
  assert.throws(() => validateCustomValues(defs, { budget: 1, tier: 'bronze' }, {}, true), /configured options/);
  assert.throws(() => validateCustomValues(defs, { budget: 1, hacked: 'x' }, {}, true), /Unknown custom field/);
  assert.deepEqual(validateCustomValues(defs, { tier: 'silver' }, { budget: 9, legacy: 'kept' }, false), { budget: 9, legacy: 'kept', tier: 'silver' });
});

test('pick lists are seeded, readable by everyone and editable only by admins', async () => {
  const read = await cfg('employee', 'GET', 'options');
  assert.equal(read.status, 200, read.text);
  assert.ok(read.body.data.company_lead_stage.some((o: any) => o.value === 'converted' && o.is_system));
  assert.equal((await cfg('employee', 'POST', 'options', { kind: 'priority', label: 'Critical' })).status, 403);
  assert.equal((await cfg('hr_manager', 'POST', 'options', { kind: 'priority', label: 'Critical' })).status, 403);
  assert.equal((await cfg('admin', 'POST', 'options', { kind: 'nonsense', label: 'x' })).status, 400);
  assert.equal((await cfg('admin', 'POST', 'options', { kind: 'priority', label: '' })).status, 400);
});

test('new stage values become valid for records; unknown ones stay rejected', async () => {
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Acme', stage: 'site_visit' }), /Invalid Lead Stage/);
  const added = await cfg('admin', 'POST', 'options', { kind: 'company_lead_stage', label: 'Site Visit' });
  assert.equal(added.status, 201, added.text); assert.equal(added.body.data.value, 'site_visit');
  assert.equal((await cfg('admin', 'POST', 'options', { kind: 'company_lead_stage', label: 'Site Visit' })).status, 409);
  const lead = await createRecord(employee, 'company-leads', { company_name: 'Acme', stage: 'site_visit' });
  assert.equal(lead.stage, 'site_visit');
  assert.ok((await listRecords(employee, 'company-leads', 50, 0, '', 'site_visit')).length === 1, 'configured stage filter works');
  assert.equal((await cfg('admin', 'PATCH', `options/${added.body.data.id}`, { value: 'renamed' })).status, 400);
  assert.equal((await cfg('admin', 'PATCH', `options/${added.body.data.id}`, { label: 'On-site Visit' })).status, 200);
});

test('system values are protected; deactivated values stay on old records but cannot be newly chosen', async () => {
  const stages = (await cfg('admin', 'GET', 'options')).body.data.company_lead_stage;
  const converted = stages.find((o: any) => o.value === 'converted'); const qualified = stages.find((o: any) => o.value === 'qualified');
  assert.equal((await cfg('admin', 'PATCH', `options/${converted.id}`, { active: false })).status, 409);
  const lead = await createRecord(employee, 'company-leads', { company_name: 'Beta', stage: 'qualified' });
  assert.equal((await cfg('admin', 'PATCH', `options/${qualified.id}`, { active: false })).status, 200);
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Gamma', stage: 'qualified' }), /Invalid Lead Stage/);
  const edited = await updateRecord(employee, 'company-leads', String(lead.id), { company_name: 'Beta Ltd', stage: 'qualified' });
  assert.equal(edited.company_name, 'Beta Ltd', 'unchanged legacy value is accepted');
  await rejects(updateRecord(employee, 'company-leads', String(lead.id), { stage: 'closed' }).then(() => updateRecord(employee, 'company-leads', String(lead.id), { stage: 'qualified' })), /Invalid Lead Stage/);
});

test('custom fields: validated, required on create, preserved after deactivation', async () => {
  assert.equal((await cfg('employee', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Budget', field_type: 'number' })).status, 403);
  assert.equal((await cfg('admin', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Full Name', field_key: 'company_name', field_type: 'text' })).status, 400);
  assert.equal((await cfg('admin', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Tier', field_type: 'select' })).status, 400);
  const budget = await cfg('admin', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Budget', field_type: 'number', required: true }); assert.equal(budget.status, 201, budget.text);
  const tier = await cfg('admin', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Tier', field_type: 'select', options: ['gold', 'silver'] }); assert.equal(tier.status, 201, tier.text);
  assert.equal((await cfg('admin', 'POST', 'custom-fields', { entity: 'company_leads', label: 'Budget', field_type: 'text' })).status, 409);
  assert.equal((await cfg('admin', 'PATCH', `custom-fields/${budget.body.data.id}`, { field_type: 'text' })).status, 400);
  assert.equal((await cfg('employee', 'GET', 'custom-fields')).body.data.length, 2);
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Delta' }), /Budget is required/);
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Delta', custom: { budget: 'lots' } }), /must be a number/);
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Delta', custom: { budget: 10, tier: 'bronze' } }), /configured options/);
  await rejects(createRecord(employee, 'company-leads', { company_name: 'Delta', custom: { budget: 10, secret: 1 } }), /Unknown custom field/);
  const lead = await createRecord(employee, 'company-leads', { company_name: 'Delta', custom: { budget: 1500, tier: 'gold' } });
  assert.deepEqual(lead.custom, { budget: 1500, tier: 'gold' });
  const upd = await updateRecord(employee, 'company-leads', String(lead.id), { custom: { tier: 'silver' } });
  assert.deepEqual(upd.custom, { budget: 1500, tier: 'silver' });
  assert.equal((await cfg('admin', 'PATCH', `custom-fields/${tier.body.data.id}`, { active: false })).status, 200);
  await rejects(updateRecord(employee, 'company-leads', String(lead.id), { custom: { tier: 'gold' } }), /Unknown custom field/);
  assert.deepEqual((await updateRecord(employee, 'company-leads', String(lead.id), { company_name: 'Delta 2' })).custom, { budget: 1500, tier: 'silver' }, 'inactive field values are preserved');
  const cand = await createRecord(employee, 'candidates', { full_name: 'Test Candidate', email: 'cand@test.local' });
  assert.deepEqual(cand.custom, {}, 'candidates are unaffected by company-lead fields');
});

test('follow-up types and workflow settings are admin-controlled and validated', async () => {
  const org = employee.organization_id;
  assert.ok((await activeValues(org, 'followup_type')).includes('whatsapp'));
  assert.ok(!(await activeValues(org, 'followup_type')).includes('site_call'));
  await cfg('admin', 'POST', 'options', { kind: 'followup_type', label: 'Site Call' });
  assert.ok((await activeValues(org, 'followup_type')).includes('site_call'));
  const callOpt = (await cfg('admin', 'GET', 'options')).body.data.followup_type.find((o: any) => o.value === 'call');
  assert.equal((await cfg('admin', 'PATCH', `options/${callOpt.id}`, { active: false })).status, 409, 'daily call counts depend on the call type');
  assert.equal((await cfg('admin', 'GET', 'workflow')).body.data.resume_followup_days, 1);
  assert.equal((await cfg('employee', 'PATCH', 'workflow', { resume_followup_days: 3 })).status, 403);
  assert.equal((await cfg('admin', 'PATCH', 'workflow', { resume_followup_days: 31 })).status, 400);
  assert.equal((await cfg('admin', 'PATCH', 'workflow', { resume_followup_days: 1.5 })).status, 400);
  assert.equal((await cfg('admin', 'PATCH', 'workflow', { resume_followup_days: 3 })).body.data.resume_followup_days, 3);
  const audits = (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'crm_%'`)).rows[0].n;
  assert.ok(audits >= 6, 'configuration changes are audited');
});
