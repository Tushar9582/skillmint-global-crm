import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantScope,withTenantScope } from '../src/lib/tenant-context';
test('concurrent requests retain separate tenant identity',async()=>{
  const a={organizationId:'tenant-a',userId:'a'},b={organizationId:'tenant-b',userId:'b'};
  assert.equal(tenantScope(),undefined);
  await Promise.all([withTenantScope(a,async()=>{await new Promise(r=>setTimeout(r,12));assert.deepEqual(tenantScope(),a);}),withTenantScope(b,async()=>{await Promise.resolve();assert.deepEqual(tenantScope(),b);})]);
  assert.equal(tenantScope(),undefined);
});
