import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG } from '../src/lib/catalog';

test('all recruitment pipeline modules are represented', () => {
  const modules=['company-leads','clients','jobs','candidates','applications','interviews','followups'];
  for(const module of modules)assert.ok(CATALOG[module],`Missing module: ${module}`);
});

test('manual company and candidate lead forms have required names and assignment fields', () => {
  const lead=CATALOG['company-leads'];
  const candidate=CATALOG.candidates;
  assert.ok(lead.fields.find(x=>x.name==='company_name'&&x.required));
  assert.ok(candidate.fields.find(x=>x.name==='full_name'&&x.required));
  assert.ok(candidate.fields.find(x=>x.name==='email'));
  assert.ok(candidate.fields.find(x=>x.name==='phone'));
  assert.ok(lead.fields.find(x=>x.name==='owner_id'));
  assert.ok(candidate.fields.find(x=>x.name==='owner_id'));
  assert.ok(lead.fields.find(x=>x.name==='next_followup_at'));
});

test('all catalog resources expose non-duplicate fields', () => {
  for(const [name,module] of Object.entries(CATALOG)) {
    assert.equal(new Set(module.fields.map(x=>x.name)).size,module.fields.length,
      `Duplicate field in ${name}`);
    assert.ok(module.columns.length>0);
    assert.ok(module.fields.some(x=>x.name==='owner_id'));
  }
});
