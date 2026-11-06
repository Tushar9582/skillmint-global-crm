'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import { downloadFile, formatDate, friendly } from '@/lib/client-api';
import { localDate } from '@/lib/hr/time';
import { computeInvoice } from '@/lib/hr/invoice';
import { Badge, Denied, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, money, send, useApi, useCan, type Row } from './ui';
import { SimBanner } from './payroll';

type Tab = 'invoices' | 'payments' | 'clients' | 'settings';
const METHODS = ['bank_transfer', 'cheque', 'cash', 'upi', 'card', 'other'];
const STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'];

export function BillingPage() {
  const can = useCan(); const [tab, setTab] = useState<Tab>('invoices');
  const report = useApi<{ data: { summary: { outstanding: number; overdue_amount: number; overdue_count: number; open_invoices: number } } }>(can('billing.view') ? '/api/v1/finance/reports' : null);
  if (!can('billing.view')) return <Denied />;
  const s = report.data?.data.summary;
  return <div className="page-shell"><PageHeading eyebrow="FINANCE & BILLING / CLIENTS" title="Billing & Invoices" subtitle="Invoices for recruitment clients, manual payment tracking and outstanding balances." />
    <SimBanner /><div className="alert">Payments are <b>manual records entered by staff</b>. No payment gateway is connected, so nothing here moves money or confirms a bank settlement.</div>
    <div className="metric-grid"><Metric label="Outstanding Balance" value={s ? money(s.outstanding) : '—'} note={`${s?.open_invoices ?? '—'} open invoices`} /><Metric label="Overdue Amount" value={s ? money(s.overdue_amount) : '—'} note={`${s?.overdue_count ?? '—'} overdue invoices`} tone={s && s.overdue_count ? 'warn' : undefined} /></div>
    <Tabs tabs={[['invoices', 'Invoices'], ['payments', 'Payment History'], ['clients', 'Client Billing'], ['settings', 'Settings & Taxes']]} value={tab} onChange={setTab} />
    {tab === 'invoices' && <Invoices onChanged={report.reload} />}{tab === 'payments' && <Payments />}{tab === 'clients' && <ClientBilling />}{tab === 'settings' && <BillingSettings />}</div>;
}

function Invoices({ onChanged }: { onChanged: () => void }) {
  const can = useCan(); const [status, setStatus] = useState(''); const [client, setClient] = useState(''); const [q, setQ] = useState('');
  const query = useMemo(() => new URLSearchParams({ ...(status ? { status } : {}), ...(client ? { client_id: client } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString(), [status, client, q]);
  const list = useApi<{ data: Row[] }>(`/api/v1/finance/invoices?${query}`); const clients = useApi<{ data: Row[] }>('/api/v1/finance/clients');
  const [form, setForm] = useState<Row | null | false>(false); const [open, setOpen] = useState<string | null>(null); const [error, setError] = useState('');
  const refresh = () => { list.reload(); onChanged(); };
  return <div className="stack"><div className="toolbar panel"><input className="form-input" style={{ maxWidth: 260 }} placeholder="Search number, client, service…" value={q} onChange={e => setQ(e.target.value)} />
    <select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{friendly(s)}</option>)}</select>
    <select value={client} onChange={e => setClient(e.target.value)}><option value="">All clients</option>{clients.data?.data.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.company_name)}</option>)}</select>
    <button className="btn ghost" onClick={() => void downloadFile('/api/v1/finance/export', 'invoices.csv').catch(e => setError(e.message))}><Download size={16} /> Export CSV</button>
    {can('billing.manage') && <button className="btn primary" onClick={() => setForm(null)}><Plus size={16} /> New Invoice</button>}</div>
    <ErrorNote message={error || list.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Invoice', 'Client', 'Date', 'Due', 'Total', 'Paid', 'Balance', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{list.loading ? <tr><td colSpan={8} className="table-empty">Loading…</td></tr> : list.data?.data.length === 0 ? <tr><td colSpan={8} className="table-empty">No invoices match.</td></tr> :
        list.data?.data.map(i => <tr key={String(i.id)}><td><button className="record-link" onClick={() => setOpen(String(i.id))}>{String(i.invoice_number ?? 'Draft')}</button></td><td>{String(i.client_name)}</td><td>{formatDate(i.invoice_date)}</td><td>{formatDate(i.due_date)}</td>
          <td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num"><b>{money(i.balance)}</b></td><td><Badge value={i.status} /></td></tr>)}</tbody></table></div></div>
    {form !== false && <InvoiceForm invoiceId={form ? String(form.id) : null} clients={clients.data?.data ?? []} onClose={() => setForm(false)} onSaved={() => { setForm(false); refresh(); }} />}
    {open && <InvoiceDetail id={open} onClose={() => setOpen(null)} onChanged={refresh} onEdit={() => { setForm({ id: open }); setOpen(null); }} />}</div>;
}

type LineRow = { description: string; quantity: string; unit_price: string };
function InvoiceForm({ invoiceId, clients, onClose, onSaved }: { invoiceId: string | null; clients: Row[]; onClose: () => void; onSaved: () => void }) {
  const existing = useApi<{ data: { invoice: Row } }>(invoiceId ? `/api/v1/finance/invoices/${invoiceId}` : null); const settings = useApi<{ data: Row; taxes: Row[] }>('/api/v1/finance/settings');
  const today = localDate(new Date()); const inv = existing.data?.data.invoice;
  const [f, setF] = useState<{ client_id: string; invoice_date: string; due_date: string; service_description: string; notes: string; lines: LineRow[]; taxIds: string[] } | null>(invoiceId ? null : { client_id: '', invoice_date: today, due_date: '', service_description: '', notes: '', lines: [{ description: '', quantity: '1', unit_price: '' }], taxIds: [] });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const form = f ?? (inv ? { client_id: String(inv.client_id), invoice_date: String(inv.invoice_date), due_date: String(inv.due_date), service_description: String(inv.service_description), notes: String(inv.notes ?? ''),
    lines: (inv.line_items as Row[]).map(l => ({ description: String(l.description), quantity: String(l.quantity), unit_price: String(l.unit_price) })), taxIds: [] as string[] } : null);
  const taxes = settings.data?.taxes.filter(t => t.active) ?? [];
  const chosen = taxes.filter(t => form?.taxIds.includes(String(t.id))).map(t => ({ name: String(t.name), rate_percent: Number(t.rate_percent) }));
  const keep = invoiceId && inv && !form?.taxIds.length ? (inv.tax_breakup as Row[]).map(t => ({ name: String(t.name), rate_percent: Number(t.rate_percent) })) : chosen;
  const totals = useMemo(() => { try { return computeInvoice((form?.lines ?? []).filter(l => l.description && Number(l.quantity) > 0).map(l => ({ description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) || 0 })), keep); } catch { return null; } }, [form, keep]);
  if (!form) return <Modal title="Invoice" onClose={onClose}><div className="modal-content">Loading…</div></Modal>;
  const set = (patch: Partial<typeof form>) => setF({ ...form, ...patch });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { client_id: form!.client_id, invoice_date: form!.invoice_date, due_date: form!.due_date || undefined, service_description: form!.service_description, notes: form!.notes,
        line_items: form!.lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })), ...(form!.taxIds.length || !invoiceId ? { tax_rate_ids: form!.taxIds } : {}) };
      await send(`/api/v1/finance/invoices${invoiceId ? `/${invoiceId}` : ''}`, invoiceId ? 'PATCH' : 'POST', payload); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); }
  }
  const setLine = (i: number, patch: Partial<LineRow>) => set({ lines: form.lines.map((l, k) => k === i ? { ...l, ...patch } : l) });
  return <Modal title={invoiceId ? 'Edit Draft Invoice' : 'New Invoice'} eyebrow="INVOICE" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Client *"><select required disabled={Boolean(invoiceId)} className="form-input" value={form.client_id} onChange={e => set({ client_id: e.target.value })}><option value="">Select client…</option>{clients.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.company_name)}</option>)}</select></Field>
    <Field label="Invoice Date *"><input required type="date" className="form-input" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} /></Field>
    <Field label={`Due Date (default: +${String(settings.data?.data.payment_terms_days ?? 15)} days)`}><input type="date" className="form-input" value={form.due_date} onChange={e => set({ due_date: e.target.value })} /></Field>
    <Field label="Service Description *" wide><input required className="form-input" value={form.service_description} onChange={e => set({ service_description: e.target.value })} placeholder="e.g. Placement fee - Senior Java Developer" /></Field>
    <div className="span-2 stack line-items"><b>Line items</b>{form.lines.map((l, i) => <div className="row-actions" key={i}><input required className="form-input" style={{ flex: 3 }} placeholder="Description" value={l.description} onChange={e => setLine(i, { description: e.target.value })} />
      <input required type="number" min={0.001} step="0.001" className="form-input" style={{ flex: 1 }} placeholder="Qty" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} />
      <input required type="number" min={0} step="0.01" className="form-input" style={{ flex: 1 }} placeholder="Unit price" value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value })} />
      <button type="button" className="icon-only" aria-label="Remove line" disabled={form.lines.length < 2} onClick={() => set({ lines: form.lines.filter((_, k) => k !== i) })}><Trash2 size={16} /></button></div>)}
      <div><button type="button" className="btn soft small" onClick={() => set({ lines: [...form.lines, { description: '', quantity: '1', unit_price: '' }] })}><Plus size={14} /> Add line</button></div></div>
    <div className="span-2 stack"><b>Taxes {invoiceId && !form.taxIds.length ? '(existing tax lines kept unless you pick new ones)' : ''}</b>{taxes.length ? taxes.map(t => <label key={String(t.id)}><input type="checkbox" checked={form.taxIds.includes(String(t.id))} onChange={e => set({ taxIds: e.target.checked ? [...form.taxIds, String(t.id)] : form.taxIds.filter(x => x !== t.id) })} /> {String(t.name)} ({String(t.rate_percent)}%)</label>) : <small className="muted">No tax rates configured. Add them under Settings & Taxes.</small>}</div>
    <Field label="Notes" wide><input className="form-input" value={form.notes} onChange={e => set({ notes: e.target.value })} /></Field>
    {totals && <div className="span-2 kv-grid"><div><small>Subtotal</small><strong>{money(totals.subtotal)}</strong></div><div><small>Tax</small><strong>{money(totals.tax_total)}</strong></div><div><small>Total</small><strong>{money(totals.total)}</strong></div></div>}</div>
    {error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save as Draft'}</button></div></form></Modal>;
}

function InvoiceDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const can = useCan(); const api = useApi<{ data: { invoice: Row; payments: Row[] } }>(`/api/v1/finance/invoices/${id}`);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [pay, setPay] = useState(false); const [reason, setReason] = useState<{ kind: 'cancel' | 'void'; paymentId?: string } | null>(null);
  const inv = api.data?.data.invoice; const payments = api.data?.data.payments ?? [];
  const done = () => { api.reload(); onChanged(); };
  async function issue() { if (!window.confirm('Issue this invoice? It receives its number and can no longer be edited.')) return; setBusy(true); setError(''); try { await send(`/api/v1/finance/invoices/${id}/send`, 'POST'); done(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to issue'); } finally { setBusy(false); } }
  const open = inv && ['sent', 'partially_paid', 'overdue'].includes(String(inv.status));
  return <Modal drawer title={inv ? String(inv.invoice_number ?? 'Draft invoice') : 'Invoice'} eyebrow="INVOICE" onClose={onClose}
    footer={inv && <><button className="btn ghost" onClick={() => void downloadFile(`/api/v1/finance/invoices/${id}/pdf`, 'invoice.pdf').catch(e => setError(e.message))}><FileText size={16} /> PDF</button>
      {can('billing.manage') && inv.status === 'draft' && <><button className="btn ghost" onClick={onEdit}>Edit</button><button className="btn primary" disabled={busy} onClick={() => void issue()}>Issue Invoice</button></>}
      {can('billing.manage') && open && <button className="btn primary" onClick={() => setPay(true)}>Record Payment</button>}
      {can('billing.manage') && inv.status !== 'cancelled' && inv.status !== 'paid' && <button className="btn ghost" onClick={() => setReason({ kind: 'cancel' })}>Cancel Invoice</button>}</>}>
    <div className="detail-content"><ErrorNote message={error || api.error} />
      {inv && <><div className="row-actions"><Badge value={inv.status} /><span className="muted">{String(inv.client_name)}</span></div>
        <div className="kv-grid"><div><small>Invoice date</small><strong>{formatDate(inv.invoice_date)}</strong></div><div><small>Due date</small><strong>{formatDate(inv.due_date)}</strong></div><div><small>Service</small><strong>{String(inv.service_description)}</strong></div><div><small>Currency</small><strong>{String(inv.currency)}</strong></div></div>
        <div className="table-scroll"><table><thead><tr>{['Description', 'Qty', 'Unit price', 'Amount'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{(inv.line_items as Row[]).map((l, i) => <tr key={i}><td>{String(l.description)}</td><td>{String(l.quantity)}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.amount)}</td></tr>)}
          <tr><td colSpan={3} className="num">Subtotal</td><td className="num">{money(inv.subtotal)}</td></tr>{(inv.tax_breakup as Row[]).map((t, i) => <tr key={i}><td colSpan={3} className="num">{String(t.name)} ({String(t.rate_percent)}%)</td><td className="num">{money(t.amount)}</td></tr>)}
          <tr><td colSpan={3} className="num"><b>Total</b></td><td className="num"><b>{money(inv.total)}</b></td></tr><tr><td colSpan={3} className="num">Paid</td><td className="num">{money(inv.paid)}</td></tr><tr><td colSpan={3} className="num"><b>Balance</b></td><td className="num"><b>{money(inv.balance)}</b></td></tr></tbody></table></div>
        <div className="detail-section"><h3>Payments</h3>{payments.length ? payments.map(p => <div className="activity-entry" key={String(p.id)} style={{ opacity: p.voided_at ? 0.55 : 1 }}><b>{money(p.amount)}</b> · {friendly(p.method)} · {formatDate(p.paid_on)} <span className={`status-badge tone-${p.source === 'gateway' ? 'good' : 'info'}`}>{p.source === 'gateway' ? 'Gateway transaction' : 'Manual entry'}</span>{Boolean(p.voided_at) && <span className="status-badge tone-bad">Voided</span>}
          <small>{String(p.reference ?? '')} {String(p.notes ?? '')} {p.recorded_by_name ? `· recorded by ${String(p.recorded_by_name)}` : ''}{p.void_reason ? ` · void: ${String(p.void_reason)}` : ''}</small>
          {can('billing.manage') && !p.voided_at && inv.status !== 'cancelled' && <button className="table-action" onClick={() => setReason({ kind: 'void', paymentId: String(p.id) })}>Void</button>}</div>) : <p className="muted">No payments recorded.</p>}</div></>}</div>
    {pay && inv && <PaymentForm invoice={inv} onClose={() => setPay(false)} onSaved={() => { setPay(false); done(); }} />}
    {reason && <ReasonForm kind={reason.kind} onClose={() => setReason(null)} onSubmit={async text => { try { if (reason.kind === 'cancel') await send(`/api/v1/finance/invoices/${id}/cancel`, 'POST', { reason: text }); else await send(`/api/v1/finance/payments/${String(reason.paymentId)}/void`, 'POST', { reason: text }); setReason(null); done(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); setReason(null); } }} />}</Modal>;
}

function ReasonForm({ kind, onClose, onSubmit }: { kind: 'cancel' | 'void'; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return <Modal wide={false} title={kind === 'cancel' ? 'Cancel invoice' : 'Void payment'} eyebrow="AUDITED ACTION" onClose={onClose}><form onSubmit={e => { e.preventDefault(); void onSubmit(text); }}><div className="modal-content stack"><Field label="Reason *"><input required className="form-input" value={text} onChange={e => setText(e.target.value)} /></Field></div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Back</button><button className="btn primary">Confirm</button></div></form></Modal>;
}

function PaymentForm({ invoice, onClose, onSaved }: { invoice: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ amount: String(invoice.balance), paid_on: localDate(new Date()), method: 'bank_transfer', reference: '', notes: '' }); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send(`/api/v1/finance/invoices/${String(invoice.id)}/payments`, 'POST', f); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to record'); } }
  return <Modal wide={false} title="Record Manual Payment" eyebrow="MANUAL ENTRY - NOT A GATEWAY TRANSACTION" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack">
    <p>Outstanding balance: <b>{money(invoice.balance)}</b>. Record only money you have confirmed receiving.</p>
    <Field label="Amount received *"><input required type="number" min={0.01} step="0.01" max={Number(invoice.balance)} className="form-input" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
    <Field label="Date received *"><input required type="date" className="form-input" value={f.paid_on} onChange={e => setF({ ...f, paid_on: e.target.value })} /></Field>
    <Field label="Method"><select className="form-input" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{METHODS.map(m => <option key={m} value={m}>{friendly(m)}</option>)}</select></Field>
    <Field label="Reference (UTR / cheque no.)"><input className="form-input" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></Field><Field label="Notes"><input className="form-input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
    {error && <div className="alert danger">{error}</div>}</div><div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Record Payment</button></div></form></Modal>;
}

function Payments() {
  const [client, setClient] = useState(''); const clients = useApi<{ data: Row[] }>('/api/v1/finance/clients'); const api = useApi<{ data: Row[] }>(`/api/v1/finance/payments${client ? `?client_id=${client}` : ''}`);
  return <div className="stack"><div className="toolbar panel"><select value={client} onChange={e => setClient(e.target.value)}><option value="">All clients</option>{clients.data?.data.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.company_name)}</option>)}</select></div><ErrorNote message={api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Date', 'Invoice', 'Client', 'Amount', 'Method', 'Reference', 'Source'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(p => <tr key={String(p.id)} style={{ opacity: p.voided_at ? 0.5 : 1 }}><td>{formatDate(p.paid_on)}</td><td>{String(p.invoice_number ?? '—')}</td><td>{String(p.client_name)}</td><td className="num">{money(p.amount)}</td><td>{friendly(p.method)}</td><td>{String(p.reference ?? '')}</td>
        <td><span className={`status-badge tone-${p.source === 'gateway' ? 'good' : 'info'}`}>{p.source === 'gateway' ? 'Gateway' : 'Manual entry'}</span>{Boolean(p.voided_at) && <span className="status-badge tone-bad">Voided</span>}</td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={7} className="table-empty">No payments recorded.</td></tr>}</tbody></table></div></div></div>;
}

function ClientBilling() {
  const api = useApi<{ data: Row[] }>('/api/v1/finance/clients');
  return <div className="stack"><ErrorNote message={api.error} /><div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Client', 'Contact', 'Invoices', 'Invoiced', 'Paid', 'Outstanding', 'Overdue'].map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{api.data?.data.map(c => <tr key={String(c.id)}><td><b>{String(c.company_name)}</b><br /><small className="muted">{String(c.city ?? '')}</small></td><td>{String(c.contact_name ?? '—')}</td><td>{String(c.invoice_count)}</td><td className="num">{money(c.invoiced)}</td><td className="num">{money(c.paid)}</td><td className="num"><b>{money(c.outstanding)}</b></td><td className="num" style={{ color: Number(c.overdue) ? '#b3483e' : undefined }}>{money(c.overdue)}</td></tr>)}</tbody></table></div></div></div>;
}

function BillingSettings() {
  const can = useCan(); const api = useApi<{ data: Row; taxes: Row[] }>('/api/v1/finance/settings'); const [f, setF] = useState<Row | null>(null); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const [tax, setTax] = useState({ name: '', rate_percent: '' });
  const v: Row = f ?? api.data?.data ?? {}; const manage = can('billing.manage'); const set = (k: string, val: unknown) => setF({ ...v, [k]: val });
  async function save(e: FormEvent) { e.preventDefault(); setError(''); setMsg(''); try { await send('/api/v1/finance/settings', 'PATCH', v); setMsg('Settings saved.'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  async function addTax(e: FormEvent) { e.preventDefault(); setError(''); try { await send('/api/v1/finance/tax-rates', 'POST', tax); setTax({ name: '', rate_percent: '' }); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add'); } }
  async function toggle(t: Row) { try { await send(`/api/v1/finance/tax-rates/${String(t.id)}`, 'PATCH', { active: !t.active }); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update'); } }
  if (!api.data) return <p>Loading…</p>;
  const input = (k: string, label: string, type = 'text') => <Field label={label}><input disabled={!manage} type={type} className="form-input" value={String(v[k] ?? '')} onChange={e => set(k, e.target.value)} /></Field>;
  return <div className="stack"><ErrorNote message={error} />{msg && <div className="alert success">{msg}</div>}
    <form className="panel" onSubmit={save}><div className="panel-header"><h2>Invoice Settings</h2></div><div className="form-grid" style={{ padding: '0 22px 22px' }}>{input('company_name', 'Company name')}{input('tax_id', 'Tax / registration ID')}{input('address', 'Address')}{input('invoice_prefix', 'Invoice number prefix')}{input('payment_terms_days', 'Default payment terms (days)', 'number')}{input('currency', 'Currency (ISO code)')}{input('payment_instructions', 'Payment instructions shown on invoices')}
      {manage && <div><button className="btn primary">Save Settings</button></div>}</div></form>
    <div className="panel table-panel"><div className="panel-header"><div><h2>Tax Rates</h2><p>Configured here, never hardcoded. Each invoice stores a snapshot of the tax lines it used.</p></div></div>
      <div className="table-scroll"><table><thead><tr>{['Tax', 'Rate', 'Active', ''].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{api.data.taxes.map(t => <tr key={String(t.id)}><td>{String(t.name)}</td><td>{String(t.rate_percent)}%</td><td>{t.active ? 'Yes' : 'No'}</td><td>{manage && <button className="table-action" onClick={() => void toggle(t)}>{t.active ? 'Deactivate' : 'Activate'}</button>}</td></tr>)}
        {!api.data.taxes.length && <tr><td colSpan={4} className="table-empty">No tax rates configured.</td></tr>}</tbody></table></div>
      {manage && <form className="form-grid" style={{ padding: 22 }} onSubmit={addTax}><Field label="Tax name *"><input required className="form-input" value={tax.name} onChange={e => setTax({ ...tax, name: e.target.value })} /></Field><Field label="Rate (%) *"><input required type="number" min={0} max={100} step="0.0001" className="form-input" value={tax.rate_percent} onChange={e => setTax({ ...tax, rate_percent: e.target.value })} /></Field><div><button className="btn soft">Add Tax Rate</button></div></form>}</div></div>;
}
