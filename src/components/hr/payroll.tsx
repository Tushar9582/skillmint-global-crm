'use client';

import { useState, type FormEvent } from 'react';
import { Download, FileText, Plus, Trash2 } from 'lucide-react';
import { downloadFile, formatDate, friendly } from '@/lib/client-api';
import { isDemoClient } from '@/lib/demo-client';
import { Badge, Denied, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, money, send, thisMonth, useApi, useCan, type Row } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodName = (y: unknown, m: unknown) => `${MONTHS[Number(m) - 1]} ${String(y)}`;
type Tab = 'runs' | 'structures' | 'rules' | 'adjustments' | 'reports';

export function SimBanner() {
  return isDemoClient() ? <div className="sim-banner">Development demo: payroll, payslips and payments here are <b>simulated</b> and use demo data only. Nothing is paid and no bank transfer is ever made.</div> : null;
}

export function PayrollPage() {
  const can = useCan(); const [tab, setTab] = useState<Tab>('runs');
  if (!can('payroll.view_all')) return <Denied />;
  return <div className="page-shell"><PageHeading eyebrow="FINANCE & BILLING / PAYROLL" title="Payroll Management" subtitle="Salary calculation from attendance, approved leave and approved overtime. Review, approve and lock each month." />
    <SimBanner />
    <Tabs tabs={[['runs', 'Payroll Runs'], ['structures', 'Salary Structures'], ['adjustments', 'Bonuses & Deductions'], ['rules', 'Statutory & Rules'], ['reports', 'Reports']]} value={tab} onChange={setTab} />
    {tab === 'runs' && <Runs />}{tab === 'structures' && <Structures />}{tab === 'adjustments' && <Adjustments />}{tab === 'rules' && <Rules />}{tab === 'reports' && <PayrollReports />}</div>;
}

function Runs() {
  const can = useCan(); const runs = useApi<{ data: Row[] }>('/api/v1/payroll/runs'); const [month, setMonth] = useState(thisMonth()); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [open, setOpen] = useState<string | null>(null);
  async function generate() {
    setBusy(true); setError(''); setNotice('');
    try { const [year, m] = month.split('-').map(Number); const r = await send<{ data: { id: string; skipped: string[] } }>('/api/v1/payroll/runs', 'POST', { year, month: m }); runs.reload(); setOpen(r.data.id); if (r.data.skipped.length) setNotice(`Skipped: ${r.data.skipped.join('; ')}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to generate payroll'); } finally { setBusy(false); }
  }
  return <div className="stack">
    {can('payroll.manage') && <div className="toolbar panel"><Field label="Pay period"><input type="month" className="form-input" value={month} onChange={e => setMonth(e.target.value)} /></Field><button className="btn primary" disabled={busy} onClick={() => void generate()}>{busy ? 'Calculating…' : 'Generate / Recalculate Payroll'}</button></div>}
    <ErrorNote message={error || runs.error} />{notice && <div className="alert">{notice}</div>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Pay Period', 'Status', 'Employees', 'Gross', 'Overtime', 'Deductions', 'Net Pay', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{runs.data?.data.map(r => <tr key={String(r.id)}><td><b>{periodName(r.period_year, r.period_month)}</b></td><td><Badge value={r.status} /></td><td>{String(r.employee_count)}</td><td className="num">{money(r.total_gross)}</td><td className="num">{money(r.total_overtime)}</td><td className="num">{money(r.total_deductions)}</td><td className="num"><b>{money(r.total_net)}</b></td><td><button className="table-action" onClick={() => setOpen(String(r.id))}>Open</button></td></tr>)}
        {!runs.data?.data.length && <tr><td colSpan={8} className="table-empty">No payroll runs yet. Choose a month and generate one.</td></tr>}</tbody></table></div></div>
    {open && <RunDetail id={open} onClose={() => setOpen(null)} onChanged={runs.reload} />}</div>;
}

function RunDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const can = useCan(); const api = useApi<{ data: { run: Row; items: Row[]; unreviewed_components: string[] } }>(`/api/v1/payroll/runs/${id}`);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [line, setLine] = useState<Row | null>(null);
  const run = api.data?.data.run; const items = api.data?.data.items ?? [];
  async function act(action: 'approve' | 'reopen' | 'finalize') {
    if (action === 'finalize' && !window.confirm('Finalize this payroll? It becomes permanently locked and employees can see their payslips.')) return;
    setBusy(true); setError(''); try { await send(`/api/v1/payroll/runs/${id}/${action}`, 'POST'); api.reload(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } finally { setBusy(false); }
  }
  async function recalc() { if (!run) return; setBusy(true); setError(''); try { await send('/api/v1/payroll/runs', 'POST', { year: run.period_year, month: run.period_month }); api.reload(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Recalculation failed'); } finally { setBusy(false); } }
  const blocking = items.filter(i => (i.warnings as Array<{ blocking: boolean }>).some(w => w.blocking)).length;
  return <Modal drawer title={run ? periodName(run.period_year, run.period_month) : 'Payroll run'} eyebrow="PAYROLL RUN" onClose={onClose}
    footer={run && <>{run.status === 'draft' && can('payroll.manage') && <><button className="btn ghost" disabled={busy} onClick={() => void recalc()}>Recalculate</button><button className="btn primary" disabled={busy} onClick={() => void act('approve')}>Approve</button></>}
      {run.status === 'approved' && can('payroll.manage') && <><button className="btn ghost" disabled={busy} onClick={() => void act('reopen')}>Return to Draft</button><button className="btn primary" disabled={busy} onClick={() => void act('finalize')}>Finalize & Lock</button></>}
      <button className="btn ghost" onClick={() => void downloadFile(`/api/v1/payroll/runs/${id}/export`, 'payroll.csv').catch(e => setError(e.message))}><Download size={16} /> Export CSV</button></>}>
    <div className="detail-content"><ErrorNote message={error || api.error} />
      {run && <><div className="row-actions"><Badge value={run.status} /><span className="muted">{String(run.employee_count)} employees</span></div>
        <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}><Metric label="Gross" value={money(run.total_gross)} /><Metric label="Net Pay" value={money(run.total_net)} /></div>
        {blocking > 0 && <div className="alert danger">{blocking} payslip(s) have blocking warnings and prevent approval.</div>}
        {api.data!.data.unreviewed_components.length > 0 && <div className="alert danger">Statutory components awaiting legal review (excluded from calculation until reviewed): {api.data!.data.unreviewed_components.join(', ')}.</div>}
        <div className="table-scroll"><table><thead><tr>{['Employee', 'Days', 'LOP', 'Gross', 'OT', 'Deductions', 'Net', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{items.map(i => { const s = i.employee_snapshot as Row; const warn = i.warnings as Array<{ message: string; blocking: boolean }>; return <tr key={String(i.id)}><td><b>{String(s.name)}</b><br /><small className="muted">{String(s.code)}</small>{warn.map((w, k) => <div key={k}><small style={{ color: w.blocking ? '#b3483e' : '#946414' }}>{w.message}</small></div>)}</td>
            <td>{String(i.payable_days)}/{String(i.working_days)}</td><td>{String(i.lop_days)}</td><td className="num">{money(i.gross)}</td><td className="num">{money(i.overtime_pay)}</td><td className="num">{money(i.total_deductions)}</td><td className="num"><b>{money(i.net)}</b></td>
            <td><div className="row-actions"><button className="table-action" onClick={() => setLine(i)}>Breakdown</button>{run.status === 'finalized' && <button className="table-action" onClick={() => void downloadFile(`/api/v1/payroll/payslips/${String(i.id)}/pdf`, 'payslip.pdf').catch(e => setError(e.message))}>PDF</button>}</div></td></tr>; })}</tbody></table></div></>}
    </div>
    {line && <Breakdown item={line} onClose={() => setLine(null)} />}</Modal>;
}

export function Breakdown({ item, onClose }: { item: Row; onClose: () => void }) {
  const lines = (item.lines as Array<{ kind: string; label: string; amount: number; note?: string }>) ?? [];
  return <Modal wide={false} title={`Payslip breakdown · ${String((item.employee_snapshot as Row)?.name ?? '')}`} eyebrow="CALCULATION" onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
    <div className="modal-content stack"><table><tbody>{lines.map((l, i) => <tr key={i}><td>{l.label}{l.note && <><br /><small className="muted">{l.note}</small></>}</td><td className="num" style={{ color: l.kind === 'deduction' ? '#b3483e' : undefined }}>{l.kind === 'deduction' ? '−' : ''}{money(l.amount)}</td></tr>)}
      <tr><td><b>Net Pay</b></td><td className="num"><b>{money(item.net)}</b></td></tr></tbody></table></div></Modal>;
}

type Comp = { name: string; type: string; value: string };
function Structures() {
  const can = useCan(); const api = useApi<{ data: Row[] }>('/api/v1/payroll/structures/summary'); const [edit, setEdit] = useState<Row | null>(null);
  return <div className="stack"><ErrorNote message={api.error} /><div className="alert">Salary figures are visible only to Finance/Payroll and Administrators. Each change creates a new effective-dated structure; history is never overwritten.</div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Department', 'Effective From', 'Basic (monthly)', 'Allowances', 'Deductions', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(r => <tr key={String(r.employee_id)}><td><b>{String(r.full_name)}</b><br /><small className="muted">{String(r.employee_code)}</small></td><td>{String(r.department ?? '—')}</td><td>{r.effective_from ? formatDate(r.effective_from) : <Badge value="pending" label="No structure" />}</td><td className="num">{r.basic == null ? '—' : money(r.basic)}</td>
        <td>{((r.allowances as Row[]) ?? []).map(a => String(a.name)).join(', ') || '—'}</td><td>{((r.deductions as Row[]) ?? []).map(a => String(a.name)).join(', ') || '—'}</td><td>{can('payroll.manage') && <button className="table-action" onClick={() => setEdit(r)}>{r.structure_id ? 'Revise' : 'Set up'}</button>}</td></tr>)}</tbody></table></div></div>
    {edit && <StructureForm row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); api.reload(); }} />}</div>;
}
function StructureForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const toRows = (x: unknown): Comp[] => ((x as Row[]) ?? []).map(a => ({ name: String(a.name), type: String(a.type), value: String(a.value) }));
  const [basic, setBasic] = useState(row.basic == null ? '' : String(row.basic)); const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + '01');
  const [allowances, setAllowances] = useState<Comp[]>(toRows(row.allowances)); const [deductions, setDeductions] = useState<Comp[]>(toRows(row.deductions)); const [notes, setNotes] = useState(''); const [error, setError] = useState('');
  const history = useApi<{ data: Row[] }>(`/api/v1/payroll/structures?employee_id=${String(row.employee_id)}`);
  async function submit(e: FormEvent) { e.preventDefault(); try { await send('/api/v1/payroll/structures', 'POST', { employee_id: row.employee_id, effective_from: from, basic, allowances, deductions, notes }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  const editor = (label: string, rows: Comp[], set: (r: Comp[]) => void) => <div className="span-2 stack"><b>{label}</b>{rows.map((r, i) => <div className="row-actions" key={i}>
    <input className="form-input" placeholder="Name" value={r.name} onChange={e => set(rows.map((x, k) => k === i ? { ...x, name: e.target.value } : x))} />
    <select className="form-input" value={r.type} onChange={e => set(rows.map((x, k) => k === i ? { ...x, type: e.target.value } : x))}><option value="fixed">Fixed amount</option><option value="percent_basic">% of basic</option></select>
    <input className="form-input" type="number" min={0} step="0.01" placeholder="Value" value={r.value} onChange={e => set(rows.map((x, k) => k === i ? { ...x, value: e.target.value } : x))} />
    <button type="button" className="icon-only" aria-label="Remove" onClick={() => set(rows.filter((_, k) => k !== i))}><Trash2 size={16} /></button></div>)}
    <div><button type="button" className="btn soft small" onClick={() => set([...rows, { name: '', type: 'fixed', value: '' }])}><Plus size={14} /> Add</button></div></div>;
  return <Modal title={`Salary structure · ${String(row.full_name)}`} eyebrow="EFFECTIVE-DATED" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Monthly Basic Salary *"><input required type="number" min={0} step="0.01" className="form-input" value={basic} onChange={e => setBasic(e.target.value)} /></Field>
    <Field label="Effective From *"><input required type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} /></Field>
    {editor('Allowances', allowances, setAllowances)}{editor('Recurring deductions (non-statutory)', deductions, setDeductions)}
    <Field label="Notes" wide><input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    {history.data?.data.length ? <div className="span-2"><b>History</b>{history.data.data.map(h => <div className="activity-entry" key={String(h.id)}>{formatDate(h.effective_from)} · {money(h.basic)}</div>)}</div> : null}</div>
    {error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save New Structure</button></div></form></Modal>;
}

function Adjustments() {
  const can = useCan(); const [month, setMonth] = useState(thisMonth()); const [y, m] = month.split('-').map(Number);
  const api = useApi<{ data: Row[] }>(`/api/v1/payroll/adjustments?year=${y}&month=${m}`); const emps = useApi<{ data: Row[] }>('/api/v1/payroll/structures/summary');
  const [f, setF] = useState({ employee_id: '', kind: 'bonus', label: '', amount: '' }); const [error, setError] = useState('');
  async function add(e: FormEvent) { e.preventDefault(); setError(''); try { await send('/api/v1/payroll/adjustments', 'POST', { ...f, year: y, month: m }); setF({ employee_id: '', kind: 'bonus', label: '', amount: '' }); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add'); } }
  async function remove(id: string) { try { await send(`/api/v1/payroll/adjustments/${id}`, 'DELETE'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to remove'); } }
  return <div className="stack"><div className="toolbar panel"><Field label="Pay period"><input type="month" className="form-input" value={month} onChange={e => setMonth(e.target.value)} /></Field></div><ErrorNote message={error || api.error} />
    {can('payroll.manage') && <form className="panel" onSubmit={add}><div className="form-grid" style={{ padding: 22 }}><Field label="Employee *"><select required className="form-input" value={f.employee_id} onChange={e => setF({ ...f, employee_id: e.target.value })}><option value="">Select…</option>{emps.data?.data.map(x => <option key={String(x.employee_id)} value={String(x.employee_id)}>{String(x.full_name)}</option>)}</select></Field>
      <Field label="Type"><select className="form-input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="bonus">Bonus / incentive</option><option value="deduction">One-off deduction</option></select></Field>
      <Field label="Label *"><input required className="form-input" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></Field><Field label="Amount *"><input required type="number" min={0.01} step="0.01" className="form-input" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
      <div><button className="btn primary">Add Adjustment</button></div></div></form>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Type', 'Label', 'Amount', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(a => <tr key={String(a.id)}><td>{String(a.employee_name)}</td><td>{friendly(a.kind)}</td><td>{String(a.label)}</td><td className="num">{money(a.amount)}</td><td>{can('payroll.manage') && <button className="table-action" onClick={() => void remove(String(a.id))}>Remove</button>}</td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={5} className="table-empty">No adjustments for this month.</td></tr>}</tbody></table></div></div></div>;
}

function Rules() {
  const can = useCan(); const comps = useApi<{ data: Row[] }>('/api/v1/payroll/components'); const settings = useApi<{ data: Row }>('/api/v1/payroll/settings');
  const [edit, setEdit] = useState<Row | null | false>(false); const [review, setReview] = useState<Row | null>(null); const [error, setError] = useState('');
  const [basis, setBasis] = useState(''); const [cur, setCur] = useState('');
  async function saveSettings(e: FormEvent) { e.preventDefault(); try { await send('/api/v1/payroll/settings', 'PATCH', { payroll_lop_basis: basis || settings.data?.data.payroll_lop_basis, payroll_currency: cur || settings.data?.data.payroll_currency }); settings.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <div className="stack"><div className="alert danger">Statutory components are configuration, not hardcoded. Each rate must be reviewed against the applicable <b>current</b> legal requirements by an authorized person before it affects payroll. Unreviewed rules are excluded and block approval.</div>
    <ErrorNote message={error || comps.error} />
    {can('payroll.manage') && <div className="heading-actions"><button className="btn primary" onClick={() => setEdit({})}><Plus size={16} /> Add Statutory Component</button></div>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Code', 'Name', 'Base', 'Rate', 'Wage Cap', 'Review', 'Active', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{comps.data?.data.map(c => <tr key={String(c.id)}><td>{String(c.code)}</td><td>{String(c.name)}</td><td>{friendly(c.base)}</td><td>{String(c.rate_percent)}%</td><td>{c.base_cap == null ? 'None' : money(c.base_cap)}</td>
        <td>{c.reviewed_at ? <><Badge value="reviewed" /><br /><small className="muted">{String(c.reviewed_by_name ?? '')} · {String(c.legal_note ?? '')}</small></> : <Badge value="pending" label="Awaiting review" />}</td><td>{c.active ? 'Yes' : 'No'}</td>
        <td>{can('payroll.manage') && <div className="row-actions"><button className="table-action" onClick={() => setEdit(c)}>Edit</button><button className="table-action" onClick={() => setReview(c)}>Review</button></div>}</td></tr>)}
        {!comps.data?.data.length && <tr><td colSpan={8} className="table-empty">No statutory components configured.</td></tr>}</tbody></table></div></div>
    {can('payroll.manage') && settings.data && <form className="panel" onSubmit={saveSettings}><div className="panel-header"><h2>Payroll Settings</h2></div><div className="form-grid" style={{ padding: '0 22px 22px' }}>
      <Field label="Loss-of-pay divisor"><select className="form-input" value={basis || String(settings.data.data.payroll_lop_basis)} onChange={e => setBasis(e.target.value)}><option value="working_days">Working days in the month</option><option value="calendar_days">Calendar days in the month</option><option value="fixed_30">Fixed 30 days</option></select></Field>
      <Field label="Currency (ISO code)"><input className="form-input" maxLength={3} value={cur || String(settings.data.data.payroll_currency)} onChange={e => setCur(e.target.value.toUpperCase())} /></Field><div><button className="btn primary">Save Settings</button></div></div></form>}
    {edit !== false && <RuleForm current={edit} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); comps.reload(); }} />}
    {review && <ReviewForm row={review} onClose={() => setReview(null)} onSaved={() => { setReview(null); comps.reload(); }} />}</div>;
}
function RuleForm({ current, onClose, onSaved }: { current: Row | null; onClose: () => void; onSaved: () => void }) {
  const c: Row = current ?? {}; const edit = Boolean(c.id); const [f, setF] = useState({ code: String(c.code ?? ''), name: String(c.name ?? ''), base: String(c.base ?? 'basic'), rate_percent: String(c.rate_percent ?? ''), base_cap: c.base_cap == null ? '' : String(c.base_cap), active: c.active !== false }); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send(`/api/v1/payroll/components${edit ? `/${String(c.id)}` : ''}`, edit ? 'PATCH' : 'POST', f); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <Modal wide={false} title={edit ? 'Edit Component' : 'Add Statutory Component'} eyebrow="CONFIGURATION" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack">
    {!edit && <Field label="Code *"><input required className="form-input" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} /></Field>}<Field label="Name *"><input required className="form-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
    <Field label="Calculated on"><select className="form-input" value={f.base} onChange={e => setF({ ...f, base: e.target.value })}><option value="basic">Earned basic</option><option value="gross">Earned gross</option></select></Field>
    <Field label="Rate (%) *"><input required type="number" min={0} max={100} step="0.0001" className="form-input" value={f.rate_percent} onChange={e => setF({ ...f, rate_percent: e.target.value })} /></Field>
    <Field label="Wage cap (optional)"><input type="number" min={0} step="0.01" className="form-input" value={f.base_cap} onChange={e => setF({ ...f, base_cap: e.target.value })} /></Field>
    {edit && <label><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}{edit && <small className="muted">Changing the rate, base or cap withdraws the existing legal review.</small>}
    {error && <div className="alert danger">{error}</div>}</div><div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div></form></Modal>;
}
function ReviewForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState(''); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send(`/api/v1/payroll/components/${String(row.id)}/review`, 'POST', { legal_note: note }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <Modal wide={false} title={`Legal review · ${String(row.code)}`} eyebrow="COMPLIANCE" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack"><p>Confirm that <b>{String(row.rate_percent)}%</b> of {String(row.base)}{row.base_cap != null ? `, capped at ${money(row.base_cap)}` : ''} matches the currently applicable legal requirement.</p>
    <Field label="Legal reference / review note *"><input required className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Notification or advisory reference, date reviewed" /></Field>{error && <div className="alert danger">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Mark as Reviewed</button></div></form></Modal>;
}

export function PayrollReports() {
  const [year, setYear] = useState(new Date().getFullYear()); const api = useApi<{ data: { runs: Row[]; by_department: Row[] } }>(`/api/v1/payroll/reports?year=${year}`);
  const sum = (k: string) => (api.data?.data.runs ?? []).filter(r => r.status === 'finalized').reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return <div className="stack"><div className="toolbar panel"><Field label="Year"><input type="number" className="form-input" value={year} onChange={e => setYear(Number(e.target.value))} /></Field></div><ErrorNote message={api.error} />
    <div className="metric-grid"><Metric label="Finalized Gross" value={money(sum('total_gross'))} /><Metric label="Finalized Deductions" value={money(sum('total_deductions'))} /><Metric label="Finalized Overtime" value={money(sum('total_overtime'))} /><Metric label="Finalized Net" value={money(sum('total_net'))} /></div>
    <div className="panel table-panel"><div className="panel-header"><h2>Monthly Payroll Register</h2></div><div className="table-scroll"><table><thead><tr>{['Month', 'Status', 'Employees', 'Gross', 'Overtime', 'Deductions', 'Net'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.runs.map(r => <tr key={String(r.period_month)}><td>{MONTHS[Number(r.period_month) - 1]}</td><td><Badge value={r.status} /></td><td>{String(r.employee_count)}</td><td className="num">{money(r.total_gross)}</td><td className="num">{money(r.total_overtime)}</td><td className="num">{money(r.total_deductions)}</td><td className="num">{money(r.total_net)}</td></tr>)}</tbody></table></div></div>
    <div className="panel table-panel"><div className="panel-header"><h2>Finalized Net Pay by Department</h2></div><div className="table-scroll"><table><thead><tr>{['Department', 'Payslips', 'Net Pay'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{api.data?.data.by_department.map(d => <tr key={String(d.department)}><td>{String(d.department ?? '—')}</td><td>{String(d.payslips)}</td><td className="num">{money(d.net)}</td></tr>)}</tbody></table></div></div></div>;
}

export function MyPayslipsPage() {
  const api = useApi<{ data: Row[] }>('/api/v1/payroll/payslips'); const [view, setView] = useState<Row | null>(null); const [error, setError] = useState('');
  return <div className="page-shell"><PageHeading eyebrow="MY ACCOUNT / PAY" title="My Payslips" subtitle="Finalized payslips appear here once payroll for the month is locked. Only you can see your own payslips." /><SimBanner /><ErrorNote message={error || api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Pay Period', 'Gross', 'Deductions', 'Net Pay', 'LOP Days', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(p => <tr key={String(p.id)}><td><b>{periodName(p.period_year, p.period_month)}</b></td><td className="num">{money(p.gross)}</td><td className="num">{money(p.total_deductions)}</td><td className="num"><b>{money(p.net)}</b></td><td>{String(p.lop_days)}</td>
        <td><div className="row-actions"><button className="table-action" onClick={() => setView({ ...p })}>View</button><button className="table-action" onClick={() => void downloadFile(`/api/v1/payroll/payslips/${String(p.id)}/pdf`, 'payslip.pdf').catch(e => setError(e.message))}><FileText size={13} /> PDF</button></div></td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={6} className="table-empty">No payslips yet.</td></tr>}</tbody></table></div></div>
    {view && <Breakdown item={view} onClose={() => setView(null)} />}</div>;
}
