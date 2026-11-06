import { RuleError, fromMinor, toMinor } from './core';

export interface LineItem { description: string; quantity: number; unit_price: number }
export interface TaxInput { name: string; rate_percent: number }
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export function validateLines(raw: unknown): LineItem[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 60) throw new RuleError(400, 'Add between 1 and 60 line items');
  return raw.map((r, i) => {
    const item = (r ?? {}) as Record<string, unknown>;
    const description = String(item.description ?? '').trim(); const quantity = Number(item.quantity); const unit = Number(item.unit_price);
    if (!description || description.length > 300) throw new RuleError(400, `Line ${i + 1} needs a description`);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) throw new RuleError(400, `Line ${i + 1} has an invalid quantity`);
    if (!Number.isFinite(unit) || unit < 0 || unit > 1e9) throw new RuleError(400, `Line ${i + 1} has an invalid price`);
    return { description, quantity: Math.round(quantity * 1000) / 1000, unit_price: unit };
  });
}

export function validateTaxes(raw: unknown): TaxInput[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw) || raw.length > 6) throw new RuleError(400, 'At most 6 tax lines are allowed');
  return raw.map(r => {
    const t = (r ?? {}) as Record<string, unknown>; const name = String(t.name ?? '').trim(); const rate = Number(t.rate_percent);
    if (!name || name.length > 60 || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new RuleError(400, 'A tax line is invalid');
    return { name, rate_percent: rate };
  });
}

/** Totals in minor units so that line amounts always add up exactly. */
export function computeInvoice(lines: LineItem[], taxes: TaxInput[]) {
  const priced = lines.map(l => ({ ...l, amount: fromMinor(Math.round(l.quantity * toMinor(l.unit_price))) }));
  const subtotal = priced.reduce((s, l) => s + toMinor(l.amount), 0);
  const tax_breakup = taxes.map(t => ({ name: t.name, rate_percent: t.rate_percent, amount: fromMinor(Math.round(subtotal * t.rate_percent / 100)) }));
  const taxTotal = tax_breakup.reduce((s, t) => s + toMinor(t.amount), 0);
  return { lines: priced, subtotal: fromMinor(subtotal), tax_breakup, tax_total: fromMinor(taxTotal), total: fromMinor(subtotal + taxTotal) };
}

/** Status shown to users. Overdue is derived from the due date; it is never stored. */
export function deriveStatus(i: { status: string; total: number; paid: number; due_date: string; today: string }): InvoiceStatus {
  if (i.status === 'draft' || i.status === 'cancelled') return i.status;
  if (toMinor(i.paid) >= toMinor(i.total) && toMinor(i.total) > 0) return 'paid';
  const open = i.paid > 0 ? 'partially_paid' : 'sent';
  return i.due_date < i.today ? 'overdue' : open;
}

export function storedStatus(total: number, paid: number): 'sent' | 'partially_paid' | 'paid' {
  if (toMinor(paid) >= toMinor(total)) return 'paid';
  return paid > 0 ? 'partially_paid' : 'sent';
}

export function checkPayment(total: number, paidBefore: number, amount: number, invoiceStatus: string) {
  if (!['sent', 'partially_paid'].includes(invoiceStatus)) throw new RuleError(409, invoiceStatus === 'draft' ? 'Issue the invoice before recording payments' : `A ${invoiceStatus} invoice cannot receive payments`);
  const outstanding = toMinor(total) - toMinor(paidBefore);
  const minor = toMinor(amount);
  if (!Number.isFinite(amount) || minor <= 0) throw new RuleError(400, 'Payment amount must be greater than zero');
  if (minor > outstanding) throw new RuleError(409, `Payment exceeds the outstanding balance of ${fromMinor(outstanding).toFixed(2)}`);
  const paid = fromMinor(toMinor(paidBefore) + minor);
  return { paid, outstanding: fromMinor(outstanding - minor), status: storedStatus(total, paid) };
}

export const formatInvoiceNumber = (prefix: string, year: number, sequence: number) => `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;

export function agingBucket(dueDate: string, today: string): 'current' | '1-30' | '31-60' | '61-90' | '90+' {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  return days <= 0 ? 'current' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
}

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'upi', 'card', 'other'] as const;
