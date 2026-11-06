import test from 'node:test';
import assert from 'node:assert/strict';
import { demoHrRequest } from '../src/lib/hr/demo-all';
import { agingBucket, checkPayment, computeInvoice, deriveStatus, formatInvoiceNumber, storedStatus, validateLines, validateTaxes } from '../src/lib/hr/invoice';
import { invoicePdf } from '../src/lib/hr/invoice-pdf';
import { localDate } from '../src/lib/hr/time';

const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: {},
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});
const as = (role: string) => mem.set('skillmint-demo-role', role);
type R = Record<string, any>;
const call = (url: string, method = 'GET', body?: unknown) => demoHrRequest<R>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const fails = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, re);
const day = (offset: number) => localDate(new Date(Date.now() + offset * 86400000));

test('invoice totals are exact and tax lines are configurable snapshots', () => {
  const r = computeInvoice([{ description: 'A', quantity: 3, unit_price: 33.33 }, { description: 'B', quantity: 0.5, unit_price: 10 }], [{ name: 'Tax X', rate_percent: 18.5 }, { name: 'Levy', rate_percent: 1 }]);
  assert.equal(r.subtotal, 104.99); assert.deepEqual(r.lines.map(l => l.amount), [99.99, 5]);
  assert.deepEqual(r.tax_breakup.map(t => t.amount), [19.42, 1.05]); assert.equal(r.tax_total, 20.47); assert.equal(r.total, 125.46);
  assert.equal(computeInvoice([{ description: 'A', quantity: 1, unit_price: 100 }], []).total, 100);
});

test('invoice input validation', () => {
  assert.throws(() => validateLines([]), /between 1 and 60/);
  assert.throws(() => validateLines([{ description: '', quantity: 1, unit_price: 1 }]), /description/);
  assert.throws(() => validateLines([{ description: 'x', quantity: 0, unit_price: 1 }]), /quantity/);
  assert.throws(() => validateLines([{ description: 'x', quantity: 1, unit_price: -5 }]), /price/);
  assert.throws(() => validateTaxes([{ name: 'T', rate_percent: 101 }]), /invalid/);
  assert.deepEqual(validateTaxes(undefined), []);
});

test('status derivation, payments and aging', () => {
  const base = { total: 1000, due_date: '2026-03-10', today: '2026-03-01' };
  assert.equal(deriveStatus({ ...base, status: 'draft', paid: 0 }), 'draft');
  assert.equal(deriveStatus({ ...base, status: 'sent', paid: 0 }), 'sent');
  assert.equal(deriveStatus({ ...base, status: 'sent', paid: 400 }), 'partially_paid');
  assert.equal(deriveStatus({ ...base, status: 'sent', paid: 1000 }), 'paid');
  assert.equal(deriveStatus({ ...base, status: 'sent', paid: 0, today: '2026-03-11' }), 'overdue');
  assert.equal(deriveStatus({ ...base, status: 'partially_paid', paid: 10, today: '2026-03-11' }), 'overdue');
  assert.equal(deriveStatus({ ...base, status: 'cancelled', paid: 0, today: '2026-04-01' }), 'cancelled');
  assert.equal(deriveStatus({ ...base, status: 'sent', paid: 1000, today: '2026-04-01' }), 'paid');
  assert.deepEqual(checkPayment(1000, 400, 600, 'partially_paid'), { paid: 1000, outstanding: 0, status: 'paid' });
  assert.equal(checkPayment(1000, 0, 250.5, 'sent').status, 'partially_paid');
  assert.throws(() => checkPayment(1000, 400, 600.01, 'partially_paid'), /exceeds the outstanding/);
  assert.throws(() => checkPayment(1000, 0, 10, 'draft'), /Issue the invoice/);
  assert.throws(() => checkPayment(1000, 0, 10, 'cancelled'), /cannot receive payments/);
  assert.equal(storedStatus(100, 100), 'paid');
  assert.equal(formatInvoiceNumber('INV', 2026, 7), 'INV-2026-0007');
  assert.deepEqual(['2026-03-10', '2026-02-20', '2026-01-20', '2025-12-20', '2025-10-01'].map(d => agingBucket(d, '2026-03-10')), ['current', '1-30', '31-60', '61-90', '90+']);
});

test('invoice PDF is structurally valid and marks simulated and cancelled documents', () => {
  const bytes = invoicePdf({ seller: { name: 'SkillMint' }, client: { name: 'Acme (Test)' }, number: 'INV-2026-0001', status: 'cancelled', invoice_date: '2026-03-01', due_date: '2026-03-16', currency: 'INR', service_description: 'Placement', simulated: true,
    lines: [{ description: 'Fee', quantity: 1, unit_price: 100, amount: 100 }], subtotal: 100, tax_breakup: [{ name: 'Tax', rate_percent: 10, amount: 10 }], tax_total: 10, total: 110, paid: 0, balance: 110, payments: [] });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4') && text.includes('TAX INVOICE') && text.includes('SIMULATED') && text.includes('CANCELLED'));
});

test('billing is limited to finance and admin roles', async () => {
  as('employee'); await fails(call('/api/v1/finance/invoices'), /permission/); await fails(call('/api/v1/finance/clients'), /permission/);
  as('hr_manager'); await fails(call('/api/v1/finance/invoices'), /permission/); await fails(call('/api/v1/finance/invoices', 'POST', {}), /permission/);
  as('finance'); const all = (await call('/api/v1/finance/invoices')).data;
  assert.deepEqual([...new Set(all.map((i: R) => i.status))].sort(), ['cancelled', 'draft', 'overdue', 'paid', 'partially_paid', 'sent']);
  assert.ok(all.filter((i: R) => i.invoice_number).every((i: R) => /^INV-\d{4}-\d{4}$/.test(i.invoice_number)));
});

test('invoice lifecycle: draft, issue, partial and full payment, void, cancel', async () => {
  as('finance');
  const settings = await call('/api/v1/finance/settings'); const taxId = settings.taxes[0].id;
  const client = (await call('/api/v1/finance/clients')).data[0];
  await fails(call('/api/v1/finance/invoices', 'POST', { client_id: client.id, service_description: 'x', line_items: [] }), /line items/);
  const created = await call('/api/v1/finance/invoices', 'POST', { client_id: client.id, service_description: 'Test placement', line_items: [{ description: 'Fee', quantity: 2, unit_price: 500 }], tax_rate_ids: [taxId] });
  let inv = (await call(`/api/v1/finance/invoices/${created.data.id}`)).data.invoice;
  assert.equal(inv.status, 'draft'); assert.equal(inv.total, 1100); assert.equal(inv.invoice_number, null);
  assert.equal(inv.due_date, new Date(Date.parse(`${inv.invoice_date}T00:00:00Z`) + 15 * 86400000).toISOString().slice(0, 10));
  await fails(call(`/api/v1/finance/invoices/${created.data.id}/payments`, 'POST', { amount: 10, paid_on: day(0), method: 'cash' }), /Issue the invoice/);
  await call(`/api/v1/finance/invoices/${created.data.id}`, 'PATCH', { line_items: [{ description: 'Fee', quantity: 1, unit_price: 1000 }] });
  assert.equal((await call(`/api/v1/finance/invoices/${created.data.id}`)).data.invoice.total, 1100, 'existing tax lines are kept when editing');
  const issued = await call(`/api/v1/finance/invoices/${created.data.id}/send`, 'POST');
  assert.match(issued.data.number, /^INV-\d{4}-\d{4}$/);
  await fails(call(`/api/v1/finance/invoices/${created.data.id}`, 'PATCH', { notes: 'x' }), /cannot be edited/);
  await fails(call(`/api/v1/finance/invoices/${created.data.id}/send`, 'POST'), /Only a draft/);
  const pay = (body: R) => call(`/api/v1/finance/invoices/${created.data.id}/payments`, 'POST', body);
  await fails(pay({ amount: 1100.01, paid_on: day(0), method: 'cash' }), /exceeds the outstanding/);
  await fails(pay({ amount: 100, paid_on: day(2), method: 'cash' }), /future/);
  await fails(pay({ amount: 100, paid_on: day(0), method: 'cash', source: 'gateway' }), /No payment gateway/);
  await fails(pay({ amount: 100, paid_on: day(0), method: 'bitcoin' }), /method/);
  const first = await pay({ amount: 400, paid_on: day(0), method: 'bank_transfer', reference: 'UTR1' });
  assert.equal(first.data.status, 'partially_paid'); assert.equal(first.data.balance, 700);
  await fails(call(`/api/v1/finance/invoices/${created.data.id}/cancel`, 'POST', { reason: 'oops' }), /Void the recorded payments/);
  const second = await pay({ amount: 700, paid_on: day(0), method: 'upi' });
  assert.equal(second.data.status, 'paid');
  await fails(pay({ amount: 1, paid_on: day(0), method: 'cash' }), /cannot receive payments/);
  await call(`/api/v1/finance/payments/${second.data.id}/void`, 'POST', { reason: 'Bounced' });
  await fails(call(`/api/v1/finance/payments/${second.data.id}/void`, 'POST', { reason: 'again' }), /already voided/);
  inv = (await call(`/api/v1/finance/invoices/${created.data.id}`)).data;
  assert.equal(inv.invoice.status, 'partially_paid'); assert.equal(inv.invoice.balance, 700);
  assert.deepEqual(inv.payments.map((p: R) => [p.source, Boolean(p.voided_at)]), [['manual', false], ['manual', true]]);
  await call(`/api/v1/finance/payments/${first.data.id}/void`, 'POST', { reason: 'Wrong invoice' });
  await call(`/api/v1/finance/invoices/${created.data.id}/cancel`, 'POST', { reason: 'Client withdrew' });
  assert.equal((await call(`/api/v1/finance/invoices/${created.data.id}`)).data.invoice.status, 'cancelled');
  await fails(call(`/api/v1/finance/invoices/${created.data.id}/cancel`, 'POST', { reason: 'again' }), /already cancelled/);
});

test('outstanding balances reconcile across invoices, clients and reports; PDFs download', async () => {
  as('finance');
  const invoices = (await call('/api/v1/finance/invoices')).data; const open = invoices.filter((i: R) => ['sent', 'partially_paid', 'overdue'].includes(i.status));
  const outstanding = Math.round(open.reduce((s: number, i: R) => s + i.balance * 100, 0)) / 100;
  const report = (await call('/api/v1/finance/reports')).data;
  assert.equal(report.summary.outstanding, outstanding);
  assert.equal(Math.round(Object.values(report.aging as R).reduce((s: number, x) => s + Number(x) * 100, 0)) / 100, outstanding);
  const clients = (await call('/api/v1/finance/clients')).data;
  assert.equal(Math.round(clients.reduce((s: number, c: R) => s + c.outstanding * 100, 0)) / 100, outstanding);
  assert.ok(report.summary.overdue_count >= 1);
  const pdf = await call(`/api/v1/finance/invoices/${invoices[0].id}/pdf`);
  assert.equal(Buffer.from(pdf.pdf, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.match((await call('/api/v1/finance/export')).csv, /Invoice Number/);
  await fails(call('/api/v1/finance/settings', 'PATCH', { invoice_prefix: 'bad prefix!' }), /prefix/);
  as('hr_manager'); await fails(call('/api/v1/finance/settings', 'PATCH', { currency: 'USD' }), /permission/);
});
