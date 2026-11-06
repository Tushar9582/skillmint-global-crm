'use client';

import { useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { downloadFile, formatDate } from '@/lib/client-api';
import { Badge, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, fmtMinutes, send, shiftMonth, thisMonth, useApi, useCan, type Row } from './ui';

type Tab = 'mine' | 'approvals' | 'report' | 'policy';

export function OvertimePage() {
  const can = useCan(); const manage = can('overtime.manage'); const [tab, setTab] = useState<Tab>('mine');
  const tabs: Array<[Tab, string]> = [['mine', 'My Overtime'], ...(manage ? [['approvals', 'Approvals'], ['report', 'Monthly Report'], ['policy', 'Rates & Policy']] as Array<[Tab, string]> : [])];
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / OVERTIME" title="Overtime Management" subtitle="Overtime is calculated from attendance. Only approved overtime reaches payroll when company policy requires approval." />
    {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
    {tab === 'mine' && <MyOvertime />}{tab === 'approvals' && <OvertimeApprovals />}{tab === 'report' && <OvertimeReport />}{tab === 'policy' && <OvertimePolicy />}</div>;
}

function MyOvertime() {
  const eligible = useApi<{ data: Row[]; requires_approval: boolean }>('/api/v1/hr/overtime/eligible'); const mine = useApi<{ data: Row[] }>('/api/v1/hr/overtime');
  const [req, setReq] = useState<Row | null>(null);
  return <div className="stack"><div className="alert">{eligible.data?.requires_approval === false ? 'Company policy: calculated overtime is paid automatically; requests are optional.' : 'Company policy: overtime must be requested and approved before it is paid.'}</div>
    <div className="panel table-panel"><div className="panel-header"><div><h2>Days with calculated overtime</h2><p>Last 60 days, not yet requested.</p></div></div><div className="table-scroll"><table><thead><tr>{['Date', 'Calculated', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{eligible.data?.data.map(r => <tr key={String(r.work_date)}><td>{formatDate(r.work_date)}</td><td>{fmtMinutes(r.calculated_minutes)}</td><td><button className="btn soft small" onClick={() => setReq(r)}>Request Approval</button></td></tr>)}
        {!eligible.data?.data.length && <tr><td colSpan={3} className="table-empty">No unrequested overtime.</td></tr>}</tbody></table></div></div>
    <OtTable rows={mine.data?.data ?? []} title="My Overtime Requests" />
    {req && <RequestForm row={req} onClose={() => setReq(null)} onSaved={() => { setReq(null); eligible.reload(); mine.reload(); }} />}</div>;
}
function RequestForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [minutes, setMinutes] = useState(String(row.calculated_minutes)); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send('/api/v1/hr/overtime', 'POST', { work_date: row.work_date, requested_minutes: minutes, reason }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit'); } }
  return <Modal wide={false} title={`Overtime request · ${formatDate(row.work_date)}`} eyebrow="OVERTIME" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack">
    <Field label={`Minutes requested (max ${String(row.calculated_minutes)})`}><input type="number" min={1} max={Number(row.calculated_minutes)} className="form-input" value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
    <Field label="Reason *"><input required className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></Field>{error && <div className="alert danger">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Submit</button></div></form></Modal>;
}

function OtTable({ rows, title, action }: { rows: Row[]; title: string; action?: (r: Row) => React.ReactNode }) {
  return <div className="panel table-panel"><div className="panel-header"><h2>{title}</h2></div><div className="table-scroll"><table><thead><tr>{['Date', ...(action ? ['Employee'] : []), 'Day', 'Calculated', 'Requested', 'Approved', 'Rate', 'Status', 'Note', ...(action ? [''] : [])].map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(r => <tr key={String(r.id)}><td>{formatDate(r.work_date)}</td>{action && <td><b>{String(r.employee_name)}</b></td>}<td>{String(r.day_type).replace('_', ' ')}</td><td>{fmtMinutes(r.calculated_minutes)}</td><td>{fmtMinutes(r.requested_minutes)}</td><td>{r.approved_minutes == null ? '—' : fmtMinutes(r.approved_minutes)}</td><td>{r.rate_multiplier ? `${String(r.rate_multiplier)}×` : '—'}</td><td><Badge value={r.status} /></td><td>{String(r.decision_note ?? r.reason ?? '')}</td>{action && <td>{action(r)}</td>}</tr>)}
      {!rows.length && <tr><td colSpan={10} className="table-empty">Nothing to show.</td></tr>}</tbody></table></div></div>;
}

function OvertimeApprovals() {
  const [status, setStatus] = useState('pending'); const api = useApi<{ data: Row[] }>(`/api/v1/hr/overtime?status=${status}`);
  const [decide, setDecide] = useState<{ row: Row; decision: 'approved' | 'rejected' } | null>(null); const [minutes, setMinutes] = useState(''); const [note, setNote] = useState(''); const [error, setError] = useState('');
  async function submit() { if (!decide) return; try { await send(`/api/v1/hr/overtime/${String(decide.row.id)}/decision`, 'POST', { decision: decide.decision, approved_minutes: decide.decision === 'approved' ? minutes : undefined, note }); setDecide(null); api.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Decision failed'); } }
  return <div className="stack"><div className="toolbar panel"><select value={status} onChange={e => setStatus(e.target.value)}>{['pending', 'approved', 'rejected'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></div><ErrorNote message={error || api.error} />
    <OtTable rows={api.data?.data ?? []} title="Overtime Requests" action={r => r.status === 'pending' ? <div className="row-actions"><button className="table-action" onClick={() => { setDecide({ row: r, decision: 'approved' }); setMinutes(String(r.requested_minutes)); setNote(''); }}>Approve</button><button className="table-action" onClick={() => { setDecide({ row: r, decision: 'rejected' }); setNote(''); }}>Reject</button></div> : null} />
    {decide && <Modal wide={false} title={`${decide.decision === 'approved' ? 'Approve' : 'Reject'} overtime · ${String(decide.row.employee_name)}`} eyebrow="OVERTIME DECISION" onClose={() => setDecide(null)}
      footer={<><button className="btn ghost" onClick={() => setDecide(null)}>Cancel</button><button className="btn primary" onClick={() => void submit()}>Confirm</button></>}>
      <div className="modal-content stack"><p>{formatDate(decide.row.work_date)} · requested {fmtMinutes(decide.row.requested_minutes)}</p>
        {decide.decision === 'approved' && <Field label="Approved minutes (cannot exceed requested)"><input type="number" min={0} max={Number(decide.row.requested_minutes)} className="form-input" value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>}
        <Field label="Note"><input className="form-input" value={note} onChange={e => setNote(e.target.value)} /></Field></div></Modal>}</div>;
}

export function OvertimeReport() {
  const [month, setMonth] = useState(thisMonth()); const api = useApi<{ data: Row[] }>(`/api/v1/hr/overtime/report?month=${month}`); const [error, setError] = useState('');
  const rows = api.data?.data ?? []; const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  return <div className="stack"><div className="heading-actions"><div className="month-nav"><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button><strong>{month}</strong><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button></div>
    <button className="btn primary" onClick={() => void downloadFile(`/api/v1/hr/overtime/export?month=${month}`, `overtime-${month}.csv`).catch(e => setError(e.message))}><Download size={16} /> Export CSV</button></div><ErrorNote message={error || api.error} />
    <div className="metric-grid"><Metric label="Calculated Hours" value={sum('calculated_hours').toFixed(2)} /><Metric label="Requested Hours" value={sum('requested_hours').toFixed(2)} /><Metric label="Approved Hours" value={sum('approved_hours').toFixed(2)} /><Metric label="Pending Requests" value={sum('pending_requests')} /></div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee', 'Department', 'Calculated (h)', 'Requested (h)', 'Approved (h)', 'Pending'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={String(r.employee_code)}><td><b>{String(r.employee_name)}</b><br /><small className="muted">{String(r.employee_code)}</small></td><td>{String(r.department ?? '—')}</td><td className="num">{String(r.calculated_hours)}</td><td className="num">{String(r.requested_hours)}</td><td className="num">{String(r.approved_hours)}</td><td className="num">{String(r.pending_requests)}</td></tr>)}</tbody></table></div></div></div>;
}

function OvertimePolicy() {
  const api = useApi<{ data: Row }>('/api/v1/hr/settings'); const [f, setF] = useState<Row | null>(null); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const v: Row = f ?? api.data?.data ?? {}; if (!f && !api.data) return <p>Loading…</p>; const set = (k: string, val: unknown) => setF({ ...v, [k]: val });
  async function save(e: FormEvent) { e.preventDefault(); setError(''); setMsg(''); try { const pick = ['overtime_requires_approval', 'overtime_min_minutes', 'overtime_weekday_multiplier', 'overtime_weekoff_multiplier', 'overtime_holiday_multiplier']; await send('/api/v1/hr/settings', 'PATCH', Object.fromEntries(pick.map(k => [k, v[k]]))); setMsg('Overtime policy saved.'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  const num = (k: string, label: string, step = '0.05') => <Field label={label}><input type="number" min={0} step={step} className="form-input" value={String(v[k])} onChange={e => set(k, e.target.value)} /></Field>;
  return <form className="panel" onSubmit={save}><div className="panel-header"><div><h2>Overtime Rates & Policy</h2><p>Multipliers apply to the employee&apos;s hourly basic rate in payroll. Changes affect future approvals only.</p></div></div>
    <div className="form-grid" style={{ padding: '0 22px 22px' }}><Field label="Approval" wide><span><input type="checkbox" checked={Boolean(v.overtime_requires_approval)} onChange={e => set('overtime_requires_approval', e.target.checked)} /> Only approved overtime affects payroll</span></Field>
      {num('overtime_min_minutes', 'Minimum minutes before overtime counts', '1')}{num('overtime_weekday_multiplier', 'Working-day rate (×)')}{num('overtime_weekoff_multiplier', 'Weekly-off rate (×)')}{num('overtime_holiday_multiplier', 'Holiday rate (×)')}
      <div><button className="btn primary">Save Policy</button></div></div><ErrorNote message={error} />{msg && <div className="alert success" style={{ margin: '0 22px 22px' }}>{msg}</div>}</form>;
}
