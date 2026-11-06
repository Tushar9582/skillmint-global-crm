'use client';

import { RuleError, toMinor, fromMinor, assertDate } from './core';
import { addDays, localDate } from './time';
import { v, has } from './validate';
import { PAYMENT_METHODS, agingBucket, checkPayment, computeInvoice, deriveStatus, formatInvoiceNumber, validateLines, validateTaxes } from './invoice';
import { invoicePdf } from './invoice-pdf';
import { toBase64 } from './pdf';
import { need, nowIso, registerDemoModule, table, uid, type DemoCtx, type DemoRoute, type Row, type Store } from './demo-hr';
import { demoSettings } from './demo-core';

const find = (store: Store, name: string, id: string) => table(store, name).find(r => r.id === id);
const today = (store: Store) => localDate(new Date(), demoSettings(store).timezone);
const settingsOf = (store: Store): Row => table(store, 'billing_settings')[0];

/** Billing clients: demo-only samples plus any clients from the CRM demo store (read-only; that store is never modified here). */
function clients(store: Store): Row[] {
  const own = table(store, 'billing_clients'); let crm: Row[] = [];
  try { const raw = localStorage.getItem('skillmint-development-demo-v1'); if (raw) crm = (JSON.parse(raw).clients ?? []) as Row[]; } catch { /* no CRM demo data yet */ }
  return [...own, ...crm.filter(c => !own.some(o => o.company_name === c.company_name))];
}
const paidOf = (store: Store, invoiceId: unknown) => fromMinor(table(store, 'billing_payments').filter(p => p.invoice_id === invoiceId && !p.voided_at).reduce((s, p) => s + toMinor(p.amount), 0));

function present(store: Store, inv: Row): Row {
  const c = clients(store).find(x => x.id === inv.client_id); const paid = paidOf(store, inv.id);
  return { ...inv, client_name: c?.company_name, stored_status: inv.status, paid, balance: fromMinor(toMinor(inv.total) - toMinor(paid)),
    status: deriveStatus({ status: String(inv.status), total: Number(inv.total), paid, due_date: String(inv.due_date), today: today(store) }) };
}
function getInvoice(store: Store, id: string): Row { const i = find(store, 'billing_invoices', id); if (!i) throw new RuleError(404, 'Invoice not found'); return i; }

function resolveTaxes(store: Store, d: Row) {
  if (Array.isArray(d.tax_rate_ids) && d.tax_rate_ids.length) {
    const rows = table(store, 'billing_tax_rates').filter(t => t.active && (d.tax_rate_ids as unknown[]).includes(t.id));
    if (rows.length !== d.tax_rate_ids.length) throw new RuleError(400, 'A selected tax rate is inactive or unknown');
    return rows.map(t => ({ name: String(t.name), rate_percent: Number(t.rate_percent) }));
  }
  return validateTaxes(d.taxes);
}
function values(store: Store, d: Row, current: Row | null) {
  const s = settingsOf(store);
  const invoiceDate = has(d, 'invoice_date') || !current ? v.date(d.invoice_date ?? today(store), 'Invoice date', true)! : String(current.invoice_date);
  const due = has(d, 'due_date') && d.due_date ? v.date(d.due_date, 'Due date', true)! : current && !has(d, 'invoice_date') ? String(current.due_date) : addDays(invoiceDate, Number(s.payment_terms_days));
  if (due < invoiceDate) throw new RuleError(400, 'Due date cannot be before the invoice date');
  const lines = validateLines(has(d, 'line_items') || !current ? d.line_items : current.line_items);
  const taxes = has(d, 'taxes') || has(d, 'tax_rate_ids') || !current ? resolveTaxes(store, d) : (current.tax_breakup as Row[]).map(t => ({ name: String(t.name), rate_percent: Number(t.rate_percent) }));
  return { invoiceDate, due, totals: computeInvoice(lines, taxes) };
}
function issue(store: Store, inv: Row) {
  const year = Number(String(inv.invoice_date).slice(0, 4)); const seqs = table(store, 'billing_sequences');
  let seq = seqs.find(x => x.year === year); if (!seq) { seq = { year, last: 0 }; seqs.push(seq); } seq.last = Number(seq.last) + 1;
  inv.invoice_number = formatInvoiceNumber(String(settingsOf(store).invoice_prefix), year, Number(seq.last)); inv.status = 'sent'; inv.sent_at = nowIso();
}

export function demoBillingSummary(store: Store) {
  const open = table(store, 'billing_invoices').filter(i => ['sent', 'partially_paid'].includes(String(i.status))).map(i => present(store, i));
  const sum = (rows: Row[]) => fromMinor(rows.reduce((s, r) => s + toMinor(r.balance), 0)); const overdue = open.filter(r => r.status === 'overdue');
  return { outstanding: sum(open), overdue_amount: sum(overdue), overdue_count: overdue.length, open_invoices: open.length };
}

function pdfFor(c: DemoCtx, inv: Row) {
  const p = present(c.store, inv); const s = settingsOf(c.store); const cl = clients(c.store).find(x => x.id === inv.client_id) ?? {};
  const bytes = invoicePdf({ seller: { name: String(s.company_name), address: s.address as string, tax_id: s.tax_id as string, payment_instructions: s.payment_instructions as string },
    client: { name: String(cl.company_name), contact: cl.contact_name as string, email: cl.contact_email as string, city: cl.city as string }, number: (inv.invoice_number as string) ?? null, status: String(p.status), invoice_date: String(inv.invoice_date), due_date: String(inv.due_date),
    currency: String(inv.currency), service_description: String(inv.service_description), notes: inv.notes as string, lines: inv.line_items as never, subtotal: Number(inv.subtotal), tax_breakup: inv.tax_breakup as never, tax_total: Number(inv.tax_total), total: Number(inv.total),
    paid: Number(p.paid), balance: Number(p.balance), payments: table(c.store, 'billing_payments').filter(x => x.invoice_id === inv.id && !x.voided_at) as never, simulated: true });
  return { filename: `${String(inv.invoice_number ?? 'draft-invoice')}-SIMULATED.pdf`, pdf: toBase64(bytes) };
}
const csv = (headers: string[], rows: unknown[][]) => { const cell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`; return '\uFEFF' + [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\r\n'); };

const routes: DemoRoute[] = [
  { method: 'GET', path: 'finance/settings', handle: c => { need(c.actor, 'billing.view'); return { data: settingsOf(c.store), taxes: table(c.store, 'billing_tax_rates') }; } },
  { method: 'PATCH', path: 'finance/settings', handle: c => { need(c.actor, 'billing.manage'); const d = c.payload; const s = settingsOf(c.store); const out: Row = {};
    if (has(d, 'company_name')) out.company_name = v.str(d.company_name, 'Company name', { required: true, max: 150 }); if (has(d, 'address')) out.address = v.str(d.address, 'Address', { max: 300 }); if (has(d, 'tax_id')) out.tax_id = v.str(d.tax_id, 'Tax ID', { max: 40 });
    if (has(d, 'invoice_prefix')) { const p = String(d.invoice_prefix ?? '').toUpperCase(); if (!/^[A-Z0-9]{1,8}$/.test(p)) throw new RuleError(400, 'Invoice prefix must be 1-8 letters or digits'); out.invoice_prefix = p; }
    if (has(d, 'payment_terms_days')) out.payment_terms_days = v.num(d.payment_terms_days, 'Payment terms', { max: 365, required: true });
    if (has(d, 'currency')) { const cur = String(d.currency ?? '').toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) throw new RuleError(400, 'Currency must be a 3-letter code'); out.currency = cur; }
    if (has(d, 'payment_instructions')) out.payment_instructions = v.str(d.payment_instructions, 'Payment instructions', { max: 400 });
    if (!Object.keys(out).length) throw new RuleError(400, 'No settings provided'); return { data: Object.assign(s, out) }; } },
  { method: 'POST', path: 'finance/tax-rates', handle: c => { need(c.actor, 'billing.manage'); const name = v.str(c.payload.name, 'Tax name', { required: true, max: 60 }); if (table(c.store, 'billing_tax_rates').some(t => t.name === name)) throw new RuleError(409, 'A tax with this name already exists');
    const row = { id: uid(), name, rate_percent: v.num(c.payload.rate_percent, 'Rate', { max: 100, required: true }), active: true }; table(c.store, 'billing_tax_rates').push(row); return { data: row }; } },
  { method: 'PATCH', path: 'finance/tax-rates/:id', handle: c => { need(c.actor, 'billing.manage'); const t = find(c.store, 'billing_tax_rates', c.params.id); if (!t) throw new RuleError(404, 'Tax rate not found'); const d = c.payload;
    if (has(d, 'name')) { const n = v.str(d.name, 'Tax name', { required: true, max: 60 }); if (table(c.store, 'billing_tax_rates').some(x => x.id !== t.id && x.name === n)) throw new RuleError(409, 'A tax with this name already exists'); t.name = n; }
    if (has(d, 'rate_percent')) t.rate_percent = v.num(d.rate_percent, 'Rate', { max: 100, required: true }); if (has(d, 'active')) t.active = v.bool(d.active); return { data: t }; } },

  { method: 'GET', path: 'finance/clients', handle: c => { need(c.actor, 'billing.view');
    const invoices = table(c.store, 'billing_invoices').filter(i => !['draft', 'cancelled'].includes(String(i.status))).map(i => present(c.store, i)); const sum = (rows: Row[], k: string) => fromMinor(rows.reduce((s, r) => s + toMinor(r[k]), 0));
    return { data: clients(c.store).map(cl => { const mine = invoices.filter(i => i.client_id === cl.id); return { id: cl.id, company_name: cl.company_name, contact_name: cl.contact_name, contact_email: cl.contact_email, city: cl.city, invoice_count: mine.length, invoiced: sum(mine, 'total'), paid: sum(mine, 'paid'), outstanding: sum(mine.filter(i => i.status !== 'paid'), 'balance'), overdue: sum(mine.filter(i => i.status === 'overdue'), 'balance') }; }) }; } },

  { method: 'GET', path: 'finance/invoices', handle: c => { need(c.actor, 'billing.view'); const q = c.query.get('q')?.toLowerCase().trim(); const from = c.query.get('from'); const to = c.query.get('to'); const status = c.query.get('status'); const client = c.query.get('client_id');
    if (from) assertDate(from, 'From date'); if (to) assertDate(to, 'To date');
    const data = table(c.store, 'billing_invoices').map(i => present(c.store, i)).filter(r => (!client || r.client_id === client) && (!status || r.status === status) && (!from || String(r.invoice_date) >= from) && (!to || String(r.invoice_date) <= to)
      && (!q || [r.invoice_number, r.client_name, r.service_description].some(x => String(x ?? '').toLowerCase().includes(q)))).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)))
      .map(r => { const { line_items: _l, tax_breakup: _t, ...rest } = r; void _l; void _t; return rest; });
    return { data }; } },
  { method: 'POST', path: 'finance/invoices', handle: c => { need(c.actor, 'billing.manage'); const d = c.payload; const cl = clients(c.store).find(x => x.id === v.uuid(d.client_id, 'Client', true)); if (!cl) throw new RuleError(404, 'Client not found');
    const { invoiceDate, due, totals } = values(c.store, d, null);
    const row = { id: uid(), client_id: cl.id, invoice_number: null, invoice_date: invoiceDate, due_date: due, service_description: v.str(d.service_description, 'Service description', { required: true, max: 500 }), line_items: totals.lines, subtotal: totals.subtotal, tax_breakup: totals.tax_breakup, tax_total: totals.tax_total, total: totals.total, currency: settingsOf(c.store).currency, status: 'draft', notes: v.str(d.notes, 'Notes', { max: 500 }), created_at: nowIso() };
    table(c.store, 'billing_invoices').unshift(row); return { data: { id: row.id } }; } },
  { method: 'GET', path: 'finance/invoices/:id', handle: c => { need(c.actor, 'billing.view'); const inv = getInvoice(c.store, c.params.id);
    return { data: { invoice: present(c.store, inv), payments: table(c.store, 'billing_payments').filter(p => p.invoice_id === inv.id).map(p => ({ ...p, recorded_by_name: p.recorded_by_name })) } }; } },
  { method: 'PATCH', path: 'finance/invoices/:id', handle: c => { need(c.actor, 'billing.manage'); const inv = getInvoice(c.store, c.params.id); if (inv.status !== 'draft') throw new RuleError(409, 'Issued invoices cannot be edited. Cancel and re-issue instead.');
    const { invoiceDate, due, totals } = values(c.store, c.payload, inv);
    return { data: Object.assign(inv, { invoice_date: invoiceDate, due_date: due, line_items: totals.lines, subtotal: totals.subtotal, tax_breakup: totals.tax_breakup, tax_total: totals.tax_total, total: totals.total,
      service_description: has(c.payload, 'service_description') ? v.str(c.payload.service_description, 'Service description', { required: true, max: 500 }) : inv.service_description, notes: has(c.payload, 'notes') ? v.str(c.payload.notes, 'Notes', { max: 500 }) : inv.notes }) }; } },
  { method: 'POST', path: 'finance/invoices/:id/send', handle: c => { need(c.actor, 'billing.manage'); const inv = getInvoice(c.store, c.params.id); if (inv.status !== 'draft') throw new RuleError(409, 'Only a draft invoice can be issued');
    if (Number(inv.total) <= 0) throw new RuleError(409, 'An invoice must have a total greater than zero'); issue(c.store, inv); return { data: { number: inv.invoice_number } }; } },
  { method: 'POST', path: 'finance/invoices/:id/cancel', handle: c => { need(c.actor, 'billing.manage'); const inv = getInvoice(c.store, c.params.id); const reason = v.str(c.payload.reason, 'Cancellation reason', { required: true, max: 300 });
    if (inv.status === 'cancelled') throw new RuleError(409, 'This invoice is already cancelled'); if (paidOf(c.store, inv.id) > 0) throw new RuleError(409, 'Void the recorded payments before cancelling this invoice');
    Object.assign(inv, { status: 'cancelled', cancelled_at: nowIso(), cancel_reason: reason }); return { ok: true }; } },
  { method: 'POST', path: 'finance/invoices/:id/payments', handle: c => { need(c.actor, 'billing.manage'); const d = c.payload; const inv = getInvoice(c.store, c.params.id);
    if (d.source && d.source !== 'manual') throw new RuleError(400, 'Only manual payment records can be created. No payment gateway is connected.');
    const amount = v.num(d.amount, 'Amount', { min: 0.01, max: 1e9, required: true })!; const paidOn = v.date(d.paid_on, 'Payment date', true)!; const method = v.oneOf(d.method, 'Payment method', PAYMENT_METHODS, true)!;
    if (paidOn > today(c.store)) throw new RuleError(400, 'Payment date cannot be in the future'); if (paidOn < String(inv.invoice_date)) throw new RuleError(400, 'Payment date cannot be before the invoice date');
    const outcome = checkPayment(Number(inv.total), paidOf(c.store, inv.id), amount, String(inv.status));
    const row = { id: uid(), invoice_id: inv.id, amount, paid_on: paidOn, method, reference: v.str(d.reference, 'Reference', { max: 100 }), source: 'manual', gateway_transaction_id: null, notes: v.str(d.notes, 'Notes', { max: 300 }), recorded_by_name: c.actor.full_name, created_at: nowIso(), voided_at: null };
    table(c.store, 'billing_payments').push(row); inv.status = outcome.status; return { data: { id: row.id, status: outcome.status, balance: outcome.outstanding } }; } },
  { method: 'POST', path: 'finance/payments/:id/void', handle: c => { need(c.actor, 'billing.manage'); const p = find(c.store, 'billing_payments', c.params.id); if (!p) throw new RuleError(404, 'Payment not found'); if (p.voided_at) throw new RuleError(409, 'This payment is already voided');
    const reason = v.str(c.payload.reason, 'Reason', { required: true, max: 300 }); Object.assign(p, { voided_at: nowIso(), void_reason: reason }); const inv = getInvoice(c.store, String(p.invoice_id)); const paid = paidOf(c.store, inv.id);
    if (inv.status !== 'cancelled') inv.status = paid >= Number(inv.total) ? 'paid' : paid > 0 ? 'partially_paid' : 'sent'; return { ok: true }; } },
  { method: 'GET', path: 'finance/payments', handle: c => { need(c.actor, 'billing.view'); const from = c.query.get('from'); const to = c.query.get('to'); const client = c.query.get('client_id');
    const data = table(c.store, 'billing_payments').map((p): Row => { const inv = find(c.store, 'billing_invoices', String(p.invoice_id))!; return { ...p, invoice_number: inv.invoice_number, client_id: inv.client_id, client_name: clients(c.store).find(x => x.id === inv.client_id)?.company_name }; })
      .filter(p => (!client || p.client_id === client) && (!from || String(p.paid_on) >= from) && (!to || String(p.paid_on) <= to)).sort((a, b) => String(b.paid_on).localeCompare(String(a.paid_on))); return { data }; } },
  { method: 'GET', path: 'finance/invoices/:id/pdf', handle: c => { need(c.actor, 'billing.view'); return pdfFor(c, getInvoice(c.store, c.params.id)); } },
  { method: 'GET', path: 'finance/export', handle: c => { need(c.actor, 'billing.view'); const rows = table(c.store, 'billing_invoices').map(i => present(c.store, i));
    return { filename: 'invoices-SIMULATED.csv', csv: csv(['Invoice Number', 'Client', 'Invoice Date', 'Due Date', 'Status', 'Subtotal', 'Tax', 'Total', 'Paid', 'Balance'], rows.map(r => [r.invoice_number ?? 'DRAFT', r.client_name, r.invoice_date, r.due_date, r.status, r.subtotal, r.tax_total, r.total, r.paid, r.balance])) }; } },
  { method: 'GET', path: 'finance/reports', handle: c => { need(c.actor, 'billing.view'); const year = Number(c.query.get('year') || today(c.store).slice(0, 4)); const t = today(c.store);
    const open = table(c.store, 'billing_invoices').filter(i => ['sent', 'partially_paid'].includes(String(i.status))).map(i => present(c.store, i)); const aging: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const r of open) aging[agingBucket(String(r.due_date), t)] += toMinor(r.balance); const byClient = new Map<string, number>(); for (const r of open) byClient.set(String(r.client_name), (byClient.get(String(r.client_name)) ?? 0) + toMinor(r.balance));
    const inv = table(c.store, 'billing_invoices').filter(i => !['draft', 'cancelled'].includes(String(i.status)) && String(i.invoice_date).startsWith(String(year))); const months = new Map<number, { invoiced: number; count: number }>();
    for (const i of inv) { const m = Number(String(i.invoice_date).slice(5, 7)); const e = months.get(m) ?? { invoiced: 0, count: 0 }; e.invoiced += Number(i.total); e.count++; months.set(m, e); }
    const col = new Map<number, number>(); for (const p of table(c.store, 'billing_payments').filter(x => !x.voided_at && String(x.paid_on).startsWith(String(year)))) { const m = Number(String(p.paid_on).slice(5, 7)); col.set(m, (col.get(m) ?? 0) + Number(p.amount)); }
    return { data: { summary: demoBillingSummary(c.store), aging: Object.fromEntries(Object.entries(aging).map(([k, x]) => [k, fromMinor(x)])), top_outstanding: [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([client, x]) => ({ client, outstanding: fromMinor(x) })),
      invoiced: [...months.entries()].sort((a, b) => a[0] - b[0]).map(([month, x]) => ({ month, ...x })), collected: [...col.entries()].sort((a, b) => a[0] - b[0]).map(([month, collected]) => ({ month, collected })), year } }; } },
];

function seed(store: Store) {
  const t = localDate(new Date(), 'Asia/Kolkata');
  table(store, 'billing_settings').push({ company_name: 'SkillMint Global', address: 'Demo address, Bengaluru (sample data)', tax_id: 'DEMO-TAX-ID-000', invoice_prefix: 'INV', payment_terms_days: 15, currency: 'INR', payment_instructions: 'Demo bank details - not real' });
  table(store, 'billing_tax_rates').push({ id: uid(), name: 'Demo tax (placeholder rate)', rate_percent: 10, active: true });
  const cl = [{ name: 'Northstar Retail', contact: 'Meera Shah', email: 'meera@northstar.example', city: 'Mumbai' }, { name: 'AsterByte Technologies', contact: 'Priya Nair', email: 'priya@asterbyte.example', city: 'Bengaluru' }, { name: 'Helio Logistics', contact: 'Rahul Menon', email: 'rahul@helio.example', city: 'Pune' }]
    .map(c => ({ id: uid(), company_name: c.name, contact_name: c.contact, contact_email: c.email, city: c.city })); table(store, 'billing_clients').push(...cl);
  const tax = [{ name: 'Demo tax (placeholder rate)', rate_percent: 10 }];
  const make = (client: Row, offset: number, termsDays: number, desc: string, lines: Array<[string, number, number]>, status: string, payments: Array<[number, number]> = []) => {
    const date = addDays(t, offset); const totals = computeInvoice(lines.map(([description, quantity, unit_price]) => ({ description, quantity, unit_price })), tax);
    const inv: Row = { id: uid(), client_id: client.id, invoice_number: null, invoice_date: date, due_date: addDays(date, termsDays), service_description: desc, line_items: totals.lines, subtotal: totals.subtotal, tax_breakup: totals.tax_breakup, tax_total: totals.tax_total, total: totals.total, currency: 'INR', status: 'draft', notes: null, created_at: nowIso() };
    table(store, 'billing_invoices').push(inv);
    if (status !== 'draft') { issue(store, inv); inv.status = 'sent'; }
    for (const [amount, daysAfter] of payments) table(store, 'billing_payments').push({ id: uid(), invoice_id: inv.id, amount, paid_on: addDays(date, daysAfter), method: 'bank_transfer', reference: 'DEMO-REF', source: 'manual', gateway_transaction_id: null, notes: 'Seeded demo payment', recorded_by_name: 'Demo Finance', created_at: nowIso(), voided_at: null });
    if (status === 'cancelled') Object.assign(inv, { status: 'cancelled', cancel_reason: 'Duplicate request (demo)', cancelled_at: nowIso() });
    else if (status !== 'draft') { const paid = payments.reduce((s, [a]) => s + a, 0); inv.status = paid >= Number(inv.total) ? 'paid' : paid > 0 ? 'partially_paid' : 'sent'; }
  };
  make(cl[1], -2, 15, 'Placement fee - Senior React Developer (draft)', [['Placement fee', 1, 120000]], 'draft');
  make(cl[0], -5, 15, 'Retained search - Retail Operations Head', [['Retainer - first milestone', 1, 75000]], 'sent');
  make(cl[2], -25, 30, 'Bulk hiring - warehouse supervisors', [['Placement fee (per candidate)', 4, 30000]], 'sent', [[50000, 10]]);
  make(cl[1], -60, 15, 'Placement fee - Backend Engineer', [['Placement fee', 1, 90000]], 'sent', [[99000, 20]]);
  make(cl[0], -45, 15, 'Placement fee - Store Manager', [['Placement fee', 1, 60000]], 'sent');
  make(cl[2], -30, 15, 'Duplicate request - cancelled', [['Placement fee', 1, 45000]], 'cancelled');
}

registerDemoModule({ name: 'billing', seed, routes });
