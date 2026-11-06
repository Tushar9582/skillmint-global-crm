import type { PoolClient } from 'pg';
import { HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { json } from '@/lib/http';
import { UUID_RE, toMinor, fromMinor, assertDate } from './core';
import { addDays, localDate } from './time';
import { v, has } from './validate';
import { PAYMENT_METHODS, agingBucket, checkPayment, computeInvoice, deriveStatus, formatInvoiceNumber, validateLines, validateTaxes, type InvoiceStatus } from './invoice';
import { invoicePdf } from './invoice-pdf';
import { csvResponse, getSettings, jsonBody, need, type Row, type ServerRoute } from './server';

async function guarded<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) { if ((error as { code?: string }).code === '23505') throw new HttpError(409, message); throw error; }
}

async function billingSettings(orgId: string, client?: PoolClient): Promise<Row> {
  await sql('INSERT INTO billing_settings(organization_id) VALUES($1) ON CONFLICT DO NOTHING', [orgId], client);
  return (await one<Row>('SELECT company_name,address,tax_id,invoice_prefix,payment_terms_days,currency,payment_instructions FROM billing_settings WHERE organization_id=$1', [orgId], client))!;
}
const todayOf = async (orgId: string) => localDate(new Date(), (await getSettings(orgId)).timezone);

const INVOICE_SELECT = `SELECT i.id,i.client_id,c.company_name AS client_name,i.invoice_number,i.invoice_date::text AS invoice_date,i.due_date::text AS due_date,i.service_description,
  i.subtotal::float AS subtotal,i.tax_total::float AS tax_total,i.total::float AS total,i.currency,i.status AS stored_status,i.notes,i.sent_at,i.cancelled_at,i.cancel_reason,i.line_items,i.tax_breakup,i.created_at,
  COALESCE((SELECT sum(p.amount) FROM billing_payments p WHERE p.invoice_id=i.id AND p.voided_at IS NULL),0)::float AS paid
  FROM billing_invoices i JOIN clients c ON c.id=i.client_id AND c.organization_id=i.organization_id`;

const present = (row: Row, today: string): Row => ({ ...row, status: deriveStatus({ status: String(row.stored_status), total: Number(row.total), paid: Number(row.paid), due_date: String(row.due_date), today }), balance: fromMinor(toMinor(row.total) - toMinor(row.paid)) });

async function loadInvoice(orgId: string, id: string, client?: PoolClient, lock = false): Promise<Row> {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Invoice not found');
  const row = await one<Row>(`${INVOICE_SELECT} WHERE i.organization_id=$1 AND i.id=$2 ${lock ? 'FOR UPDATE OF i' : ''}`, [orgId, id], client);
  if (!row) throw new HttpError(404, 'Invoice not found');
  return row;
}

async function resolveTaxes(orgId: string, d: Row) {
  if (Array.isArray(d.tax_rate_ids) && d.tax_rate_ids.length) {
    const ids = d.tax_rate_ids.map(x => String(v.uuid(x, 'Tax rate', true)));
    const rows = await sql<{ name: string; rate_percent: number }>(`SELECT name,rate_percent::float AS rate_percent FROM billing_tax_rates WHERE organization_id=$1 AND active=true AND id=ANY($2::uuid[]) ORDER BY name`, [orgId, ids]);
    if (rows.length !== ids.length) throw new HttpError(400, 'A selected tax rate is inactive or unknown');
    return rows;
  }
  return validateTaxes(d.taxes);
}

async function invoiceValues(orgId: string, d: Row, current: Row | null) {
  const settings = await billingSettings(orgId); const today = await todayOf(orgId);
  const invoiceDate = has(d, 'invoice_date') || !current ? v.date(d.invoice_date ?? today, 'Invoice date', true)! : String(current.invoice_date);
  const due = has(d, 'due_date') && d.due_date ? v.date(d.due_date, 'Due date', true)! : current && !has(d, 'invoice_date') ? String(current.due_date) : addDays(invoiceDate, Number(settings.payment_terms_days));
  if (due < invoiceDate) throw new HttpError(400, 'Due date cannot be before the invoice date');
  const lines = validateLines(has(d, 'line_items') || !current ? d.line_items : (current.line_items as unknown));
  const taxes = has(d, 'taxes') || has(d, 'tax_rate_ids') || !current ? await resolveTaxes(orgId, d) : (current.tax_breakup as Row[]).map(t => ({ name: String(t.name), rate_percent: Number(t.rate_percent) }));
  const totals = computeInvoice(lines, taxes);
  return { invoiceDate, due, totals, settings };
}

export async function billingSummary(orgId: string) {
  const today = await todayOf(orgId);
  const rows = (await sql<Row>(`${INVOICE_SELECT} WHERE i.organization_id=$1 AND i.status IN ('sent','partially_paid')`, [orgId])).map(r => present(r, today));
  const outstanding = rows.reduce((s, r) => s + toMinor(r.balance), 0);
  const overdue = rows.filter(r => r.status === 'overdue');
  return { outstanding: fromMinor(outstanding), overdue_amount: fromMinor(overdue.reduce((s, r) => s + toMinor(r.balance), 0)), overdue_count: overdue.length, open_invoices: rows.length };
}

export const financeRoutes: ServerRoute[] = [
  { method: 'GET', path: 'settings', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id;
    return json({ data: await billingSettings(orgId), taxes: await sql(`SELECT id,name,rate_percent::float AS rate_percent,active FROM billing_tax_rates WHERE organization_id=$1 ORDER BY name`, [orgId]) });
  } },
  { method: 'PATCH', path: 'settings', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; await billingSettings(orgId);
    const out: Row = {};
    if (has(d, 'company_name')) out.company_name = v.str(d.company_name, 'Company name', { required: true, max: 150 });
    if (has(d, 'address')) out.address = v.str(d.address, 'Address', { max: 300 });
    if (has(d, 'tax_id')) out.tax_id = v.str(d.tax_id, 'Tax ID', { max: 40 });
    if (has(d, 'invoice_prefix')) { const p = String(d.invoice_prefix ?? '').toUpperCase(); if (!/^[A-Z0-9]{1,8}$/.test(p)) throw new HttpError(400, 'Invoice prefix must be 1-8 letters or digits'); out.invoice_prefix = p; }
    if (has(d, 'payment_terms_days')) out.payment_terms_days = v.num(d.payment_terms_days, 'Payment terms', { max: 365, required: true });
    if (has(d, 'currency')) { const c = String(d.currency ?? '').toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw new HttpError(400, 'Currency must be a 3-letter code'); out.currency = c; }
    if (has(d, 'payment_instructions')) out.payment_instructions = v.str(d.payment_instructions, 'Payment instructions', { max: 400 });
    const keys = Object.keys(out); if (!keys.length) throw new HttpError(400, 'No settings provided');
    await sql(`UPDATE billing_settings SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')},updated_at=now() WHERE organization_id=$${keys.length + 1}`, [...keys.map(k => out[k]), orgId]);
    await audit(ctx.actor, 'billing_settings_update', 'billing_settings', null, { fields: keys });
    return json({ data: await billingSettings(orgId) });
  } },
  { method: 'POST', path: 'tax-rates', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request);
    const row = await guarded(() => one<Row>(`INSERT INTO billing_tax_rates(organization_id,name,rate_percent) VALUES($1,$2,$3) RETURNING id`, [ctx.actor.organization_id, v.str(d.name, 'Tax name', { required: true, max: 60 }), v.num(d.rate_percent, 'Rate', { max: 100, required: true })]), 'A tax with this name already exists');
    await audit(ctx.actor, 'tax_rate_create', 'billing_tax_rates', String(row!.id), { name: d.name, rate_percent: d.rate_percent });
    return json({ data: row }, 201);
  } },
  { method: 'PATCH', path: 'tax-rates/:id', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const out: Row = {};
    if (has(d, 'name')) out.name = v.str(d.name, 'Tax name', { required: true, max: 60 });
    if (has(d, 'rate_percent')) out.rate_percent = v.num(d.rate_percent, 'Rate', { max: 100, required: true });
    if (has(d, 'active')) out.active = v.bool(d.active);
    const keys = Object.keys(out); if (!keys.length) throw new HttpError(400, 'Nothing to change');
    const row = await guarded(() => one<Row>(`UPDATE billing_tax_rates SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE organization_id=$${keys.length + 1} AND id=$${keys.length + 2} RETURNING id`, [...keys.map(k => out[k]), ctx.actor.organization_id, ctx.params.id]), 'A tax with this name already exists');
    if (!row) throw new HttpError(404, 'Tax rate not found');
    await audit(ctx.actor, 'tax_rate_update', 'billing_tax_rates', ctx.params.id, { fields: keys });
    return json({ data: row });
  } },

  { method: 'GET', path: 'clients', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId);
    const clients = await sql<Row>(`SELECT id,company_name,contact_name,contact_email,city FROM clients WHERE organization_id=$1 ORDER BY company_name`, [orgId]);
    const invoices = (await sql<Row>(`${INVOICE_SELECT} WHERE i.organization_id=$1 AND i.status<>'draft' AND i.status<>'cancelled'`, [orgId])).map(r => present(r, today));
    const data = clients.map(c => {
      const mine = invoices.filter(i => i.client_id === c.id); const sum = (rows: Row[], k: string) => fromMinor(rows.reduce((s, r) => s + toMinor(r[k]), 0));
      const open = mine.filter(i => i.status !== 'paid');
      return { ...c, invoice_count: mine.length, invoiced: sum(mine, 'total'), paid: sum(mine, 'paid'), outstanding: sum(open, 'balance'), overdue: sum(mine.filter(i => i.status === 'overdue'), 'balance') };
    });
    return json({ data });
  } },

  { method: 'GET', path: 'invoices', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId);
    const where = ['i.organization_id=$1']; const args: unknown[] = [orgId];
    const add = (t: string, val: unknown) => { args.push(val); where.push(t.replaceAll('?', `$${args.length}`)); };
    const client = ctx.query.get('client_id'); if (client) add('i.client_id=?', v.uuid(client, 'Client'));
    const from = ctx.query.get('from'); if (from) add('i.invoice_date>=?::date', assertDate(from, 'From date'));
    const to = ctx.query.get('to'); if (to) add('i.invoice_date<=?::date', assertDate(to, 'To date'));
    const q = ctx.query.get('q')?.trim(); if (q) add('(i.invoice_number ILIKE ? OR c.company_name ILIKE ? OR i.service_description ILIKE ?)', `%${q.slice(0, 80)}%`);
    let rows = (await sql<Row>(`${INVOICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.invoice_date DESC,i.created_at DESC LIMIT 1000`, args)).map(r => present(r, today));
    const status = ctx.query.get('status'); if (status) rows = rows.filter(r => r.status === status);
    return json({ data: rows.map(({ line_items: _l, tax_breakup: _t, ...rest }) => rest) });
  } },
  { method: 'POST', path: 'invoices', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    const client = await one<Row>('SELECT id FROM clients WHERE id=$1 AND organization_id=$2', [v.uuid(d.client_id, 'Client', true), orgId]); if (!client) throw new HttpError(404, 'Client not found');
    const { invoiceDate, due, totals, settings } = await invoiceValues(orgId, d, null);
    const row = await one<Row>(`INSERT INTO billing_invoices(organization_id,client_id,invoice_date,due_date,service_description,line_items,subtotal,tax_breakup,tax_total,total,currency,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13) RETURNING id`,
      [orgId, client.id, invoiceDate, due, v.str(d.service_description, 'Service description', { required: true, max: 500 }), JSON.stringify(totals.lines), totals.subtotal, JSON.stringify(totals.tax_breakup), totals.tax_total, totals.total, settings.currency, v.str(d.notes, 'Notes', { max: 500 }), ctx.actor.id]);
    await audit(ctx.actor, 'invoice_create', 'billing_invoices', String(row!.id), { total: totals.total });
    return json({ data: row }, 201);
  } },
  { method: 'GET', path: 'invoices/:id', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId);
    const inv = present(await loadInvoice(orgId, ctx.params.id), today);
    const payments = await sql(`SELECT p.id,p.amount::float AS amount,p.paid_on::text AS paid_on,p.method,p.reference,p.source,p.gateway_transaction_id,p.notes,p.created_at,p.voided_at,p.void_reason,u.full_name AS recorded_by_name
      FROM billing_payments p LEFT JOIN users u ON u.id=p.recorded_by WHERE p.organization_id=$1 AND p.invoice_id=$2 ORDER BY p.paid_on,p.created_at`, [orgId, ctx.params.id]);
    return json({ data: { invoice: inv, payments } });
  } },
  { method: 'PATCH', path: 'invoices/:id', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    const cur = await loadInvoice(orgId, ctx.params.id); if (cur.stored_status !== 'draft') throw new HttpError(409, 'Issued invoices cannot be edited. Cancel and re-issue instead.');
    const { invoiceDate, due, totals } = await invoiceValues(orgId, d, cur);
    const row = await one<Row>(`UPDATE billing_invoices SET invoice_date=$3,due_date=$4,service_description=$5,line_items=$6::jsonb,subtotal=$7,tax_breakup=$8::jsonb,tax_total=$9,total=$10,notes=$11,updated_at=now()
      WHERE id=$1 AND organization_id=$2 AND status='draft' RETURNING id`, [ctx.params.id, orgId, invoiceDate, due, has(d, 'service_description') ? v.str(d.service_description, 'Service description', { required: true, max: 500 }) : cur.service_description,
      JSON.stringify(totals.lines), totals.subtotal, JSON.stringify(totals.tax_breakup), totals.tax_total, totals.total, has(d, 'notes') ? v.str(d.notes, 'Notes', { max: 500 }) : cur.notes]);
    if (!row) throw new HttpError(409, 'Issued invoices cannot be edited');
    await audit(ctx.actor, 'invoice_update', 'billing_invoices', ctx.params.id, { total: totals.total });
    return json({ data: row });
  } },
  { method: 'POST', path: 'invoices/:id/send', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const orgId = ctx.actor.organization_id;
    const result = await transaction(async client => {
      const inv = await loadInvoice(orgId, ctx.params.id, client, true);
      if (inv.stored_status !== 'draft') throw new HttpError(409, 'Only a draft invoice can be issued');
      if (Number(inv.total) <= 0) throw new HttpError(409, 'An invoice must have a total greater than zero');
      const settings = await billingSettings(orgId, client); const year = Number(String(inv.invoice_date).slice(0, 4));
      const seq = await one<{ last_number: number }>(`INSERT INTO billing_invoice_sequences(organization_id,invoice_year,last_number) VALUES($1,$2,1)
        ON CONFLICT (organization_id,invoice_year) DO UPDATE SET last_number=billing_invoice_sequences.last_number+1 RETURNING last_number`, [orgId, year], client);
      const number = formatInvoiceNumber(String(settings.invoice_prefix), year, seq!.last_number);
      await sql(`UPDATE billing_invoices SET invoice_number=$3,status='sent',sent_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2`, [inv.id, orgId, number], client);
      await audit(ctx.actor, 'invoice_issue', 'billing_invoices', String(inv.id), { number }, client);
      return { number };
    });
    return json({ data: result });
  } },
  { method: 'POST', path: 'invoices/:id/cancel', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const reason = v.str(d.reason, 'Cancellation reason', { required: true, max: 300 });
    await transaction(async client => {
      const inv = await loadInvoice(orgId, ctx.params.id, client, true);
      if (inv.stored_status === 'cancelled') throw new HttpError(409, 'This invoice is already cancelled');
      if (Number(inv.paid) > 0) throw new HttpError(409, 'Void the recorded payments before cancelling this invoice');
      await sql(`UPDATE billing_invoices SET status='cancelled',cancelled_at=now(),cancel_reason=$3,updated_at=now() WHERE id=$1 AND organization_id=$2`, [inv.id, orgId, reason], client);
      await audit(ctx.actor, 'invoice_cancel', 'billing_invoices', String(inv.id), { reason }, client);
    });
    return json({ ok: true });
  } },
  { method: 'POST', path: 'invoices/:id/payments', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id;
    if (d.source && d.source !== 'manual') throw new HttpError(400, 'Only manual payment records can be created. No payment gateway is connected.');
    const amount = v.num(d.amount, 'Amount', { min: 0.01, max: 1e9, required: true })!; const paidOn = v.date(d.paid_on, 'Payment date', true)!;
    const method = v.oneOf(d.method, 'Payment method', PAYMENT_METHODS, true)!;
    if (paidOn > (await todayOf(orgId))) throw new HttpError(400, 'Payment date cannot be in the future');
    const row = await transaction(async client => {
      const inv = await loadInvoice(orgId, ctx.params.id, client, true);
      if (paidOn < String(inv.invoice_date)) throw new HttpError(400, 'Payment date cannot be before the invoice date');
      const outcome = checkPayment(Number(inv.total), Number(inv.paid), amount, String(inv.stored_status));
      const payment = await one<Row>(`INSERT INTO billing_payments(organization_id,invoice_id,amount,paid_on,method,reference,source,notes,recorded_by) VALUES($1,$2,$3,$4,$5,$6,'manual',$7,$8) RETURNING id`,
        [orgId, inv.id, amount, paidOn, method, v.str(d.reference, 'Reference', { max: 100 }), v.str(d.notes, 'Notes', { max: 300 }), ctx.actor.id], client);
      await sql(`UPDATE billing_invoices SET status=$3,updated_at=now() WHERE id=$1 AND organization_id=$2`, [inv.id, orgId, outcome.status], client);
      await audit(ctx.actor, 'payment_record', 'billing_invoices', String(inv.id), { amount, method, source: 'manual', balance: outcome.outstanding }, client);
      return { ...payment, status: outcome.status, balance: outcome.outstanding };
    });
    return json({ data: row }, 201);
  } },
  { method: 'POST', path: 'payments/:id/void', handle: async ctx => {
    need(ctx.actor, 'billing.manage'); const d = await jsonBody(ctx.request); const orgId = ctx.actor.organization_id; const reason = v.str(d.reason, 'Reason', { required: true, max: 300 });
    await transaction(async client => {
      const pay = await one<Row>('SELECT id,invoice_id,voided_at FROM billing_payments WHERE id=$1 AND organization_id=$2 FOR UPDATE', [ctx.params.id, orgId], client);
      if (!pay) throw new HttpError(404, 'Payment not found'); if (pay.voided_at) throw new HttpError(409, 'This payment is already voided');
      const inv = await loadInvoice(orgId, String(pay.invoice_id), client, true);
      await sql(`UPDATE billing_payments SET voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1`, [pay.id, ctx.actor.id, reason], client);
      const paid = Number((await one<{ s: number }>('SELECT COALESCE(sum(amount),0)::float AS s FROM billing_payments WHERE invoice_id=$1 AND voided_at IS NULL', [inv.id], client))!.s);
      const status = inv.stored_status === 'cancelled' ? 'cancelled' : paid >= Number(inv.total) ? 'paid' : paid > 0 ? 'partially_paid' : 'sent';
      await sql('UPDATE billing_invoices SET status=$2,updated_at=now() WHERE id=$1', [inv.id, status], client);
      await audit(ctx.actor, 'payment_void', 'billing_invoices', String(inv.id), { payment_id: pay.id, reason }, client);
    });
    return json({ ok: true });
  } },
  { method: 'GET', path: 'payments', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id;
    const where = ['p.organization_id=$1']; const args: unknown[] = [orgId];
    const add = (t: string, val: unknown) => { args.push(val); where.push(t.replaceAll('?', `$${args.length}`)); };
    const client = ctx.query.get('client_id'); if (client) add('i.client_id=?', v.uuid(client, 'Client'));
    const from = ctx.query.get('from'); if (from) add('p.paid_on>=?::date', assertDate(from, 'From date'));
    const to = ctx.query.get('to'); if (to) add('p.paid_on<=?::date', assertDate(to, 'To date'));
    return json({ data: await sql(`SELECT p.id,p.invoice_id,i.invoice_number,c.company_name AS client_name,p.amount::float AS amount,p.paid_on::text AS paid_on,p.method,p.reference,p.source,p.voided_at,p.void_reason
      FROM billing_payments p JOIN billing_invoices i ON i.id=p.invoice_id JOIN clients c ON c.id=i.client_id WHERE ${where.join(' AND ')} ORDER BY p.paid_on DESC,p.created_at DESC LIMIT 500`, args) });
  } },
  { method: 'GET', path: 'invoices/:id/pdf', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId);
    const inv = present(await loadInvoice(orgId, ctx.params.id), today); const settings = await billingSettings(orgId);
    const client = (await one<Row>('SELECT company_name,contact_name,contact_email,city FROM clients WHERE id=$1', [inv.client_id]))!;
    const payments = await sql<Row>(`SELECT paid_on::text AS paid_on,method,reference,amount::float AS amount FROM billing_payments WHERE invoice_id=$1 AND voided_at IS NULL ORDER BY paid_on`, [inv.id]);
    await audit(ctx.actor, 'invoice_pdf', 'billing_invoices', String(inv.id), {});
    const pdf = invoicePdf({ seller: { name: String(settings.company_name), address: settings.address as string, tax_id: settings.tax_id as string, payment_instructions: settings.payment_instructions as string },
      client: { name: String(client.company_name), contact: client.contact_name as string, email: client.contact_email as string, city: client.city as string }, number: inv.invoice_number as string | null, status: String(inv.status),
      invoice_date: String(inv.invoice_date), due_date: String(inv.due_date), currency: String(inv.currency), service_description: String(inv.service_description), notes: inv.notes as string,
      lines: inv.line_items as never, subtotal: Number(inv.subtotal), tax_breakup: inv.tax_breakup as never, tax_total: Number(inv.tax_total), total: Number(inv.total), paid: Number(inv.paid), balance: Number(inv.balance), payments: payments as never });
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${String(inv.invoice_number ?? 'draft-invoice')}.pdf"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } },
  { method: 'GET', path: 'export', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId);
    const rows = (await sql<Row>(`${INVOICE_SELECT} WHERE i.organization_id=$1 ORDER BY i.invoice_date DESC`, [orgId])).map(r => present(r, today));
    await audit(ctx.actor, 'invoice_export', 'billing_invoices', null, {});
    return csvResponse('invoices.csv', ['Invoice Number', 'Client', 'Invoice Date', 'Due Date', 'Status', 'Subtotal', 'Tax', 'Total', 'Paid', 'Balance'], rows.map(r => [r.invoice_number ?? 'DRAFT', r.client_name, r.invoice_date, r.due_date, r.status, r.subtotal, r.tax_total, r.total, r.paid, r.balance]));
  } },
  { method: 'GET', path: 'reports', handle: async ctx => {
    need(ctx.actor, 'billing.view'); const orgId = ctx.actor.organization_id; const today = await todayOf(orgId); const year = Number(ctx.query.get('year') || today.slice(0, 4));
    const open = (await sql<Row>(`${INVOICE_SELECT} WHERE i.organization_id=$1 AND i.status IN ('sent','partially_paid')`, [orgId])).map(r => present(r, today));
    const aging: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    for (const r of open) aging[agingBucket(String(r.due_date), today)] += toMinor(r.balance);
    const byClient = new Map<string, number>(); for (const r of open) byClient.set(String(r.client_name), (byClient.get(String(r.client_name)) ?? 0) + toMinor(r.balance));
    const invoiced = await sql(`SELECT extract(month FROM invoice_date)::int AS month,sum(total)::float AS invoiced,count(*)::int AS count FROM billing_invoices WHERE organization_id=$1 AND status<>'draft' AND status<>'cancelled' AND extract(year FROM invoice_date)=$2 GROUP BY 1 ORDER BY 1`, [orgId, year]);
    const collected = await sql(`SELECT extract(month FROM paid_on)::int AS month,sum(amount)::float AS collected FROM billing_payments WHERE organization_id=$1 AND voided_at IS NULL AND extract(year FROM paid_on)=$2 GROUP BY 1 ORDER BY 1`, [orgId, year]);
    return json({ data: { summary: await billingSummary(orgId), aging: Object.fromEntries(Object.entries(aging).map(([k, x]) => [k, fromMinor(x)])), top_outstanding: [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([client, x]) => ({ client, outstanding: fromMinor(x) })), invoiced, collected, year } });
  } },
];

export type { InvoiceStatus };
