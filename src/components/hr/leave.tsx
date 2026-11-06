'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatDate, friendly } from '@/lib/client-api';
import { localDate } from '@/lib/hr/time';
import { Badge, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, send, shiftMonth, thisMonth, useApi, useCan, type Row } from './ui';

type Tab = 'mine' | 'approvals' | 'calendar' | 'balances' | 'types';

export function LeavePage() {
  const can = useCan(); const manage = can('leave.manage');
  const [tab, setTab] = useState<Tab>('mine');
  const tabs: Array<[Tab, string]> = [['mine', 'My Leave'], ...(manage ? [['approvals', 'Approvals & History'], ['calendar', 'Leave Calendar'], ['balances', 'Balances'], ['types', 'Leave Types']] as Array<[Tab, string]> : [])];
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / LEAVE" title="Leave Management" subtitle="Apply for leave, track balances and approve requests. Weekends and holidays follow each leave type's policy." />
    {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
    {tab === 'mine' && <MyLeave />}{tab === 'approvals' && <Approvals />}{tab === 'calendar' && <LeaveCalendar />}{tab === 'balances' && <Balances />}{tab === 'types' && <LeaveTypes />}</div>;
}

function MyLeave() {
  const balances = useApi<{ data: Row[]; year: number }>('/api/v1/hr/leave/balances');
  const types = useApi<{ data: Row[] }>('/api/v1/hr/leave/types');
  const requests = useApi<{ data: Row[] }>('/api/v1/hr/leave/requests');
  const [open, setOpen] = useState(false); const [error, setError] = useState('');
  async function cancel(id: string) { if (!window.confirm('Cancel this leave request?')) return; try { await send(`/api/v1/hr/leave/requests/${id}/cancel`, 'POST'); requests.reload(); balances.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to cancel'); } }
  return <div className="stack"><div className="heading-actions"><button className="btn primary" onClick={() => setOpen(true)}><Plus size={16} /> Apply for Leave</button></div>
    <ErrorNote message={error || balances.error} />
    <div className="metric-grid">{balances.data?.data.map(b => <Metric key={String(b.leave_type_id)} label={String(b.name)} value={`${String(b.remaining)} left`} note={`${String(b.total)} total · ${String(b.used)} used · ${String(b.pending)} pending`} />)}</div>
    <div className="panel table-panel"><div className="panel-header"><h2>My Requests</h2></div><div className="table-scroll"><table><thead><tr>{['Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Note', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{requests.data?.data.map(r => <tr key={String(r.id)}><td>{String(r.leave_type)}</td><td>{formatDate(r.start_date)}</td><td>{formatDate(r.end_date)}</td><td>{String(r.days)}{r.half_day ? ` (${String(r.half_day_part)} half)` : ''}</td><td>{String(r.reason ?? '')}</td><td><Badge value={r.status} /></td><td>{String(r.decision_note ?? '')}</td>
        <td>{['pending', 'approved'].includes(String(r.status)) && <button className="table-action" onClick={() => void cancel(String(r.id))}>Cancel</button>}</td></tr>)}
        {!requests.data?.data.length && <tr><td colSpan={8} className="table-empty">No leave requests yet.</td></tr>}</tbody></table></div></div>
    {open && <ApplyForm types={(types.data?.data ?? []).filter(t => t.active)} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); requests.reload(); balances.reload(); }} />}</div>;
}

function ApplyForm({ types, onClose, onSaved }: { types: Row[]; onClose: () => void; onSaved: () => void }) {
  const today = localDate(new Date());
  const [f, setF] = useState({ leave_type_id: '', start_date: today, end_date: today, half_day: false, half_day_part: 'first', reason: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v, ...(k === 'half_day' && v ? { end_date: p.start_date } : {}), ...(k === 'start_date' && p.half_day ? { end_date: String(v) } : {}) }));
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await send('/api/v1/hr/leave/requests', 'POST', f); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to apply'); } finally { setBusy(false); } }
  return <Modal title="Apply for Leave" eyebrow="LEAVE REQUEST" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Leave Type *"><select required className="form-input" value={f.leave_type_id} onChange={e => set('leave_type_id', e.target.value)}><option value="">Select…</option>{types.map(t => <option key={String(t.id)} value={String(t.id)}>{String(t.name)}{t.paid ? '' : ' (unpaid)'}</option>)}</select></Field>
    <Field label="Half-day"><span><input type="checkbox" checked={f.half_day} onChange={e => set('half_day', e.target.checked)} /> Half-day leave</span></Field>
    <Field label="Start Date *"><input required type="date" className="form-input" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></Field>
    <Field label="End Date *"><input required type="date" disabled={f.half_day} className="form-input" value={f.end_date} min={f.start_date} onChange={e => set('end_date', e.target.value)} /></Field>
    {f.half_day && <Field label="Which half?"><select className="form-input" value={f.half_day_part} onChange={e => set('half_day_part', e.target.value)}><option value="first">First half</option><option value="second">Second half</option></select></Field>}
    <Field label="Reason *" wide><textarea required className="form-input" rows={3} value={f.reason} onChange={e => set('reason', e.target.value)} /></Field></div>
    {error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button></div></form></Modal>;
}

function Approvals() {
  const [status, setStatus] = useState('pending'); const [employee, setEmployee] = useState('');
  const emps = useApi<{ data: Row[] }>('/api/v1/hr/employees');
  const api = useApi<{ data: Row[] }>(`/api/v1/hr/leave/requests?${new URLSearchParams({ ...(status ? { status } : {}), ...(employee ? { employee_id: employee } : {}) })}`);
  const [decide, setDecide] = useState<{ row: Row; decision: 'approved' | 'rejected' } | null>(null); const [note, setNote] = useState(''); const [error, setError] = useState('');
  async function submit() { if (!decide) return; try { await send(`/api/v1/hr/leave/requests/${String(decide.row.id)}/decision`, 'POST', { decision: decide.decision, note }); setDecide(null); setNote(''); api.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Decision failed'); } }
  return <div className="stack"><div className="toolbar panel"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['pending', 'approved', 'rejected', 'cancelled'].map(s => <option key={s} value={s}>{friendly(s)}</option>)}</select>
    <select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">All employees (leave history)</option>{emps.data?.data.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></div>
    <ErrorNote message={error || api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(r => <tr key={String(r.id)}><td><b>{String(r.employee_name)}</b><br /><small className="muted">{String(r.department ?? '')}</small></td><td>{String(r.leave_type)}</td><td>{formatDate(r.start_date)}</td><td>{formatDate(r.end_date)}</td><td>{String(r.days)}</td><td>{String(r.reason ?? '')}</td><td><Badge value={r.status} /></td>
        <td>{r.status === 'pending' && <div className="row-actions"><button className="table-action" onClick={() => setDecide({ row: r, decision: 'approved' })}>Approve</button><button className="table-action" onClick={() => setDecide({ row: r, decision: 'rejected' })}>Reject</button></div>}</td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={8} className="table-empty">No requests match.</td></tr>}</tbody></table></div></div>
    {decide && <Modal wide={false} title={`${decide.decision === 'approved' ? 'Approve' : 'Reject'} leave · ${String(decide.row.employee_name)}`} eyebrow="LEAVE DECISION" onClose={() => setDecide(null)}
      footer={<><button className="btn ghost" onClick={() => setDecide(null)}>Cancel</button><button className="btn primary" onClick={() => void submit()}>Confirm {decide.decision === 'approved' ? 'Approval' : 'Rejection'}</button></>}>
      <div className="modal-content"><p>{formatDate(decide.row.start_date)} – {formatDate(decide.row.end_date)} · {String(decide.row.days)} day(s)</p><Field label="Note (optional)"><input className="form-input" value={note} onChange={e => setNote(e.target.value)} /></Field></div></Modal>}</div>;
}

function LeaveCalendar() {
  const [month, setMonth] = useState(thisMonth());
  const api = useApi<{ data: Row[]; from: string; to: string }>(`/api/v1/hr/leave/calendar?month=${month}`);
  const holidays = useApi<{ data: Row[] }>(`/api/v1/hr/holidays?year=${month.slice(0, 4)}`);
  const days = useMemo(() => { const [y, m] = month.split('-').map(Number); return Array.from({ length: new Date(Date.UTC(y, m, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); }, [month]);
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return <div className="panel"><div className="panel-header"><div><h2>Leave Calendar</h2><p>Approved leave in solid text, pending in italics.</p></div><div className="month-nav"><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button><strong>{month}</strong><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button></div></div>
    <div className="stack" style={{ padding: '0 22px 22px' }}><ErrorNote message={api.error} /><div className="cal-head">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}</div>
      <div className="cal-grid">{Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="cal-cell blank" />)}{days.map(d => {
        const on = (api.data?.data ?? []).filter(r => String(r.start_date) <= d && String(r.end_date) >= d); const hol = holidays.data?.data.find(h => h.holiday_date === d);
        return <div key={d} className={`cal-cell ${hol ? 's-holiday' : ''}`}><b>{Number(d.slice(8))}</b>{hol && <small>{String(hol.name)}</small>}{on.map(r => <span key={String(r.id)} style={{ fontStyle: r.status === 'pending' ? 'italic' : 'normal' }}>{String(r.employee_name).split(' ')[0]}{r.half_day ? ' ½' : ''}</span>)}</div>; })}</div></div></div>;
}

function Balances() {
  const emps = useApi<{ data: Row[] }>('/api/v1/hr/employees?active=true'); const [employee, setEmployee] = useState(''); const year = new Date().getFullYear();
  const api = useApi<{ data: Row[]; year: number }>(employee ? `/api/v1/hr/leave/balances?employee_id=${employee}&year=${year}` : null);
  const [adjust, setAdjust] = useState<Row | null>(null);
  return <div className="stack"><div className="toolbar panel"><select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Select employee…</option>{emps.data?.data.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></div>
    <ErrorNote message={api.error} />{employee && <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Leave Type', 'Allocated', 'Adjustment', 'Used', 'Pending', 'Remaining', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(b => <tr key={String(b.leave_type_id)}><td><b>{String(b.name)}</b></td><td>{String(b.allocated)}</td><td>{String(b.adjustment)}</td><td>{String(b.used)}</td><td>{String(b.pending)}</td><td><b>{String(b.remaining)}</b></td><td><button className="table-action" onClick={() => setAdjust(b)}>Adjust</button></td></tr>)}</tbody></table></div></div>}
    {adjust && <AdjustForm employeeId={employee} year={year} row={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); api.reload(); }} />}</div>;
}
function AdjustForm({ employeeId, year, row, onClose, onSaved }: { employeeId: string; year: number; row: Row; onClose: () => void; onSaved: () => void }) {
  const [allocated, setAllocated] = useState(String(row.allocated)); const [adjustment, setAdjustment] = useState(String(row.adjustment)); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send('/api/v1/hr/leave/balances', 'POST', { employee_id: employeeId, leave_type_id: row.leave_type_id, year, allocated, adjustment, reason }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <Modal wide={false} title={`Adjust ${String(row.name)} balance (${year})`} eyebrow="AUDITED CHANGE" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack">
    <Field label="Allocated days"><input type="number" step="0.5" min={0} className="form-input" value={allocated} onChange={e => setAllocated(e.target.value)} /></Field>
    <Field label="Adjustment (+/-)"><input type="number" step="0.5" className="form-input" value={adjustment} onChange={e => setAdjustment(e.target.value)} /></Field>
    <Field label="Reason *"><input required className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></Field>{error && <div className="alert danger">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div></form></Modal>;
}

function LeaveTypes() {
  const api = useApi<{ data: Row[] }>('/api/v1/hr/leave/types'); const [edit, setEdit] = useState<Row | null | false>(false);
  return <div className="stack"><div className="heading-actions"><button className="btn primary" onClick={() => setEdit({})}><Plus size={16} /> Add Leave Type</button></div><ErrorNote message={api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Name', 'Code', 'Annual Quota', 'Paid', 'Weekends Count', 'Holidays Count', 'Negative Balance', 'Approval', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(t => <tr key={String(t.id)}><td><b>{String(t.name)}</b></td><td>{String(t.code)}</td><td>{String(t.annual_quota)}</td><td>{t.paid ? 'Paid' : 'Unpaid (loss of pay)'}</td><td>{t.count_weekends ? 'Yes' : 'No'}</td><td>{t.count_holidays ? 'Yes' : 'No'}</td><td>{t.allow_negative ? 'Allowed' : 'Blocked'}</td><td>{t.requires_approval ? 'Required' : 'Automatic'}</td><td><Badge value={t.active ? 'active' : 'inactive'} /></td><td><button className="table-action" onClick={() => setEdit(t)}>Edit</button></td></tr>)}</tbody></table></div></div>
    {edit !== false && <TypeForm current={edit} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); api.reload(); }} />}</div>;
}
function TypeForm({ current, onClose, onSaved }: { current: Row | null; onClose: () => void; onSaved: () => void }) {
  const c: Row = current ?? {}; const edit = Boolean(c.id);
  const [f, setF] = useState({ name: String(c.name ?? ''), code: String(c.code ?? ''), annual_quota: String(c.annual_quota ?? 0), paid: c.paid !== false, count_weekends: Boolean(c.count_weekends), count_holidays: Boolean(c.count_holidays), allow_negative: Boolean(c.allow_negative), requires_approval: c.requires_approval !== false, active: c.active !== false });
  const [error, setError] = useState(''); const set = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));
  async function submit(e: FormEvent) { e.preventDefault(); try { await send(`/api/v1/hr/leave/types${edit ? `/${String(c.id)}` : ''}`, edit ? 'PATCH' : 'POST', f); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  const box = (k: keyof typeof f, label: string) => <label><input type="checkbox" checked={Boolean(f[k])} onChange={e => set(k, e.target.checked)} /> {label}</label>;
  return <Modal title={edit ? 'Edit Leave Type' : 'Add Leave Type'} eyebrow="LEAVE POLICY" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Name *"><input required className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></Field><Field label="Code *"><input required maxLength={12} className="form-input" value={f.code} onChange={e => set('code', e.target.value)} /></Field>
    <Field label="Annual Quota (days)"><input type="number" step="0.5" min={0} className="form-input" value={f.annual_quota} onChange={e => set('annual_quota', e.target.value)} /></Field>
    <div className="stack span-2">{box('paid', 'Paid leave (unpaid leave becomes loss of pay in payroll)')}{box('count_weekends', 'Weekly offs inside the range count as leave')}{box('count_holidays', 'Holidays inside the range count as leave')}{box('allow_negative', 'Allow balance to go negative')}{box('requires_approval', 'Requires approval')}{edit && box('active', 'Active')}</div></div>
    {error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div></form></Modal>;
}
