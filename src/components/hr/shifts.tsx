'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { History, Plus } from 'lucide-react';
import { formatDate, friendly } from '@/lib/client-api';
import { localDate } from '@/lib/hr/time';
import { Badge, Denied, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, send, useApi, useCan, type Row } from './ui';

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayList = (days: unknown) => ((days as number[]) ?? []).map(d => DAYS[d]).join(', ') || '—';

export function ShiftsPage() {
  const can = useCan();
  const [tab, setTab] = useState<'shifts' | 'assign' | 'settings'>('shifts');
  const shifts = useApi<{ data: Row[] }>(can('shifts.manage') ? '/api/v1/hr/shifts' : null);
  const roster = useApi<{ data: Row[] }>(can('shifts.manage') ? '/api/v1/hr/shifts/roster' : null);
  const [edit, setEdit] = useState<Row | null | false>(false);
  if (!can('shifts.manage')) return <Denied />;
  const rows = shifts.data?.data ?? [];
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / SCHEDULING" title="Shift Scheduling" subtitle="Morning, evening, night and custom shifts with grace periods, breaks and weekly offs."
    actions={<button className="btn primary" onClick={() => setEdit({})}><Plus size={16} /> Create Shift</button>} />
    <div className="metric-grid"><Metric label="Active Shifts" value={rows.filter(s => s.active).length} /><Metric label="Employees Scheduled" value={roster.data?.data.filter(r => r.shift_id).length ?? '—'} />
      <Metric label="Unscheduled" value={roster.data?.data.filter(r => !r.shift_id).length ?? '—'} note="Use the company default shift" /><Metric label="Night Shifts" value={rows.filter(s => s.kind === 'night' && s.active).length} /></div>
    <Tabs tabs={[['shifts', 'Shifts'], ['assign', 'Assignments'], ['settings', 'Attendance Policy']]} value={tab} onChange={setTab} />
    <ErrorNote message={shifts.error} />
    {tab === 'shifts' && <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Shift', 'Type', 'Timing', 'Break', 'Grace', 'Weekly Off', 'Working Days', 'Employees', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(s => <tr key={String(s.id)}><td><b>{String(s.name)}</b></td><td>{friendly(s.kind)}</td><td>{String(s.start_time)} – {String(s.end_time)}{String(s.end_time) <= String(s.start_time) ? ' (+1 day)' : ''}</td><td>{String(s.break_minutes)} min</td><td>{String(s.grace_minutes)} min</td><td>{dayList(s.weekly_off)}</td><td>{dayList(s.working_days)}</td><td>{String(s.assigned)}</td>
        <td><Badge value={s.active ? 'active' : 'inactive'} /></td><td><button className="table-action" onClick={() => setEdit(s)}>Edit</button></td></tr>)}
        {!rows.length && <tr><td colSpan={10} className="table-empty">No shifts yet. Employees use the company default (09:30–18:30) until a shift is assigned.</td></tr>}</tbody></table></div></div>}
    {tab === 'assign' && <Assignments shifts={rows.filter(s => s.active)} roster={roster.data?.data ?? []} onDone={() => { roster.reload(); shifts.reload(); }} />}
    {tab === 'settings' && <PolicyForm />}
    {edit !== false && <ShiftForm current={edit} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); shifts.reload(); }} />}
  </div>;
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return <div className="row-actions">{DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={value.includes(i)} onChange={e => onChange(e.target.checked ? [...value, i].sort() : value.filter(x => x !== i))} /> {d}</label>)}</div>;
}

function ShiftForm({ current, onClose, onSaved }: { current: Row | null; onClose: () => void; onSaved: () => void }) {
  const cur: Row = current ?? {}; const edit = Boolean(cur.id);
  const [f, setF] = useState({ name: String(cur.name ?? ''), kind: String(cur.kind ?? 'custom'), start_time: String(cur.start_time ?? '09:00'), end_time: String(cur.end_time ?? '18:00'),
    break_minutes: String(cur.break_minutes ?? 60), grace_minutes: String(cur.grace_minutes ?? 10), weekly_off: (cur.weekly_off as number[]) ?? [0], working_days: (cur.working_days as number[]) ?? [1, 2, 3, 4, 5, 6], active: cur.active !== false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await send(`/api/v1/hr/shifts${edit ? `/${String(cur.id)}` : ''}`, edit ? 'PATCH' : 'POST', f); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); } }
  const set = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));
  return <Modal title={edit ? 'Edit Shift' : 'Create Shift'} eyebrow="SHIFT SCHEDULING" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Shift Name *"><input required className="form-input" value={f.name} onChange={e => set('name', e.target.value)} /></Field>
    <Field label="Type"><select className="form-input" value={f.kind} onChange={e => set('kind', e.target.value)}>{['morning', 'evening', 'night', 'custom'].map(k => <option key={k} value={k}>{friendly(k)}</option>)}</select></Field>
    <Field label="Start Time *"><input required type="time" className="form-input" value={f.start_time} onChange={e => set('start_time', e.target.value)} /></Field>
    <Field label="End Time * (earlier than start = overnight)"><input required type="time" className="form-input" value={f.end_time} onChange={e => set('end_time', e.target.value)} /></Field>
    <Field label="Break (minutes)"><input type="number" min={0} max={240} className="form-input" value={f.break_minutes} onChange={e => set('break_minutes', e.target.value)} /></Field>
    <Field label="Grace Period (minutes)"><input type="number" min={0} max={120} className="form-input" value={f.grace_minutes} onChange={e => set('grace_minutes', e.target.value)} /></Field>
    <Field label="Weekly Off" wide><DayPicker value={f.weekly_off} onChange={v => set('weekly_off', v)} /></Field>
    <Field label="Working Days" wide><DayPicker value={f.working_days} onChange={v => set('working_days', v)} /></Field>
    {edit && <Field label="Status" wide><span><input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Active (changes apply to future attendance only)</span></Field>}
  </div>{error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Shift'}</button></div></form></Modal>;
}

function Assignments({ shifts, roster, onDone }: { shifts: Row[]; roster: Row[]; onDone: () => void }) {
  const [checked, setChecked] = useState<string[]>([]); const [shiftId, setShiftId] = useState(''); const [from, setFrom] = useState(localDate(new Date()));
  const [department, setDepartment] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [result, setResult] = useState<{ assigned: number; skipped: string[] } | null>(null); const [history, setHistory] = useState<Row | null>(null);
  const departments = useMemo(() => [...new Set(roster.map(r => String(r.department ?? '')).filter(Boolean))].sort(), [roster]);
  async function assign(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setResult(null);
    try { const r = await send<{ data: { assigned: number; skipped: string[] } }>('/api/v1/hr/shifts/assign', 'POST', { shift_id: shiftId, effective_from: from, employee_ids: checked, department: department || undefined, reason }); setResult(r.data); setChecked([]); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Assignment failed'); } finally { setBusy(false); }
  }
  return <div className="stack"><form className="panel" onSubmit={assign}><div className="panel-header"><div><h2>Assign Shift</h2><p>Select employees below, a whole department, or both. The previous assignment ends the day before.</p></div></div>
    <div className="form-grid" style={{ padding: '0 22px 22px' }}><Field label="Shift *"><select required className="form-input" value={shiftId} onChange={e => setShiftId(e.target.value)}><option value="">Select shift…</option>{shifts.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)} ({String(s.start_time)}–{String(s.end_time)})</option>)}</select></Field>
      <Field label="Effective From *"><input required type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="Group: whole department (optional)"><select className="form-input" value={department} onChange={e => setDepartment(e.target.value)}><option value="">None</option>{departments.map(d => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Reason"><input className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <div><button className="btn primary" disabled={busy || !shiftId || (!checked.length && !department)}>{busy ? 'Assigning…' : `Assign (${checked.length}${department ? ' + department' : ''})`}</button></div></div>
    <ErrorNote message={error} />{result && <div className="alert success" style={{ margin: '0 22px 22px' }}>{result.assigned} employee(s) assigned.{result.skipped.length ? ` Skipped: ${result.skipped.join('; ')}` : ''}</div>}</form>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th><input type="checkbox" aria-label="Select all" checked={roster.length > 0 && checked.length === roster.length} onChange={e => setChecked(e.target.checked ? roster.map(r => String(r.employee_id)) : [])} /></th>{['Employee', 'Department', 'Current Shift', 'Since', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{roster.map(r => <tr key={String(r.employee_id)}><td><input type="checkbox" aria-label={`Select ${String(r.full_name)}`} checked={checked.includes(String(r.employee_id))} onChange={e => setChecked(c => e.target.checked ? [...c, String(r.employee_id)] : c.filter(x => x !== r.employee_id))} /></td>
        <td><b>{String(r.full_name)}</b><br /><small className="muted">{String(r.employee_code)}</small></td><td>{String(r.department ?? '—')}</td><td>{r.shift_name ? `${String(r.shift_name)} (${String(r.start_time)}–${String(r.end_time)})` : <span className="muted">Company default</span>}</td><td>{r.effective_from ? formatDate(r.effective_from) : '—'}</td>
        <td><button className="table-action" onClick={() => setHistory(r)}><History size={13} /> History</button></td></tr>)}</tbody></table></div></div>
    {history && <ShiftHistory employee={history} onClose={() => setHistory(null)} />}</div>;
}

function ShiftHistory({ employee, onClose }: { employee: Row; onClose: () => void }) {
  const api = useApi<{ data: Row[] }>(`/api/v1/hr/shifts/history?employee_id=${String(employee.employee_id)}`);
  return <Modal title={`Shift history · ${String(employee.full_name)}`} eyebrow="SHIFT CHANGES" onClose={onClose} footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
    <div className="modal-content stack">{api.data?.data.map(h => <div className="activity-entry" key={String(h.id)}><b>{String(h.shift_name)}</b><small>{formatDate(h.effective_from)} → {h.effective_to ? formatDate(h.effective_to) : 'present'} · by {String(h.changed_by_name ?? 'System')}</small>{Boolean(h.reason) && <p>{String(h.reason)}</p>}</div>)}{api.data && !api.data.data.length && <p className="muted">No assignments yet.</p>}</div></Modal>;
}

function PolicyForm() {
  const api = useApi<{ data: Row }>('/api/v1/hr/settings'); const [f, setF] = useState<Row | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  const s = api.data?.data; const v = f ?? s;
  if (!v) return <p>Loading…</p>;
  const set = (k: string, val: unknown) => setF({ ...v, [k]: val });
  async function save(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); setMsg(''); try { const { timezone, default_weekly_off, standard_daily_hours, full_day_ratio, half_day_ratio, max_open_hours } = v!; await send('/api/v1/hr/settings', 'PATCH', { timezone, default_weekly_off, standard_daily_hours, full_day_ratio, half_day_ratio, max_open_hours }); setMsg('Policy saved. It applies to future calculations.'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); } }
  return <form className="panel" onSubmit={save}><div className="panel-header"><div><h2>Attendance Policy</h2><p>Used for shifts, day classification and missing-punch handling.</p></div></div>
    <div className="form-grid" style={{ padding: '0 22px 22px' }}>
      <Field label="Company Time Zone (IANA)"><input className="form-input" value={String(v.timezone)} onChange={e => set('timezone', e.target.value)} /></Field>
      <Field label="Standard Daily Hours"><input type="number" step="0.5" className="form-input" value={String(v.standard_daily_hours)} onChange={e => set('standard_daily_hours', e.target.value)} /></Field>
      <Field label="Default Weekly Off (when a shift has none)" wide><DayPicker value={(v.default_weekly_off as number[]) ?? []} onChange={d => set('default_weekly_off', d)} /></Field>
      <Field label="Present if worked ≥ this share of the shift"><input type="number" step="0.05" min={0.1} max={1} className="form-input" value={String(v.full_day_ratio)} onChange={e => set('full_day_ratio', e.target.value)} /></Field>
      <Field label="Half-day if worked ≥ this share"><input type="number" step="0.05" min={0.05} max={1} className="form-input" value={String(v.half_day_ratio)} onChange={e => set('half_day_ratio', e.target.value)} /></Field>
      <Field label="Hours before an open punch is a missing punch-out"><input type="number" min={1} max={48} className="form-input" value={String(v.max_open_hours)} onChange={e => set('max_open_hours', e.target.value)} /></Field>
      <div><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Policy'}</button></div></div>
    <ErrorNote message={error} />{msg && <div className="alert success" style={{ margin: '0 22px 22px' }}>{msg}</div>}</form>;
}
