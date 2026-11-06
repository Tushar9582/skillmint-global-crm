'use client';

import { useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { formatDate, friendly } from '@/lib/client-api';
import { Badge, ErrorNote, Field, Modal, PageHeading, Tabs, send, useApi, useCan, type Row } from './ui';

const TYPES = ['public', 'company', 'optional', 'regional'];

export function HolidaysPage() {
  const can = useCan(); const manage = can('holidays.manage');
  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const api = useApi<{ data: Row[] }>(`/api/v1/hr/holidays?year=${year}`);
  const [edit, setEdit] = useState<Row | null | false>(false); const [error, setError] = useState('');
  const rows = api.data?.data ?? [];
  async function remove(row: Row) {
    if (!window.confirm(`Delete holiday "${String(row.name)}"? Attendance, leave and payroll will treat the day as a working day.`)) return;
    try { await send(`/api/v1/hr/holidays/${String(row.id)}`, 'DELETE'); api.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  }
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / CALENDAR" title="Holiday Calendar" subtitle="Company holidays feed attendance, leave and payroll calculations."
    actions={<><div className="month-nav"><button className="btn ghost small" onClick={() => setYear(year - 1)} aria-label="Previous year"><ChevronLeft size={15} /></button><strong>{year}</strong><button className="btn ghost small" onClick={() => setYear(year + 1)} aria-label="Next year"><ChevronRight size={15} /></button></div>
      {manage && <button className="btn primary" onClick={() => setEdit({})}><Plus size={16} /> Add Holiday</button>}</>} />
    <ErrorNote message={error || api.error} />
    <Tabs tabs={[['list', 'Yearly List'], ['calendar', 'Calendar View']]} value={view} onChange={setView} />
    {view === 'list' ? <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Date', 'Day', 'Holiday', 'Type', 'Applies To', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{!rows.length ? <tr><td colSpan={6} className="table-empty">No holidays for {year}.</td></tr> : rows.map(h => <tr key={String(h.id)}><td>{formatDate(h.holiday_date)}</td><td>{new Date(`${String(h.holiday_date)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}</td><td><b>{String(h.name)}</b></td><td><Badge value={h.holiday_type} /></td>
        <td>{[...((h.locations as string[]) ?? []), ...((h.teams as string[]) ?? [])].join(', ') || 'Everyone'}</td><td>{manage && <div className="row-actions"><button className="table-action" onClick={() => setEdit(h)}>Edit</button><button className="table-action" onClick={() => void remove(h)}>Delete</button></div>}</td></tr>)}</tbody></table></div></div>
      : <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>{Array.from({ length: 12 }, (_, m) => <MiniMonth key={m} year={year} month={m} holidays={rows} />)}</div>}
    {edit !== false && <HolidayForm current={edit} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); api.reload(); }} />}
  </div>;
}

function MiniMonth({ year, month, holidays }: { year: number; month: number; holidays: Row[] }) {
  const first = new Date(Date.UTC(year, month, 1)); const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDate = new Map(holidays.map(h => [String(h.holiday_date), h]));
  return <div className="panel" style={{ padding: 14 }}><b>{first.toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' })}</b>
    <div className="cal-grid" style={{ marginTop: 8, gap: 3 }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="cal-head" style={{ display: 'block' }}>{d}</div>)}
      {Array.from({ length: first.getUTCDay() }, (_, i) => <div key={`b${i}`} />)}
      {Array.from({ length: count }, (_, i) => { const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; const h = byDate.get(date);
        return <div key={date} title={h ? String(h.name) : undefined} className={h ? 'cal-cell s-holiday' : 'cal-cell'} style={{ minHeight: 28, padding: 3, textAlign: 'center', fontSize: 11, fontWeight: h ? 800 : 400 }}>{i + 1}</div>; })}</div>
    {[...byDate.values()].filter(h => String(h.holiday_date).startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)).map(h => <small key={String(h.id)} className="muted" style={{ display: 'block' }}>{String(h.holiday_date).slice(8)} · {String(h.name)}</small>)}</div>;
}

function HolidayForm({ current: currentRow, onClose, onSaved }: { current: Row | null; onClose: () => void; onSaved: () => void }) {
  const current: Row = currentRow ?? {};
  const edit = Boolean(current.id);
  const [form, setForm] = useState({ name: String(current.name ?? ''), holiday_date: String(current.holiday_date ?? ''), holiday_type: String(current.holiday_type ?? 'public'),
    locations: ((current.locations as string[]) ?? []).join(', '), teams: ((current.teams as string[]) ?? []).join(', '), notes: String(current.notes ?? '') });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await send(`/api/v1/hr/holidays${edit ? `/${String(current.id)}` : ''}`, edit ? 'PATCH' : 'POST', form); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); } }
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));
  return <Modal title={edit ? 'Edit Holiday' : 'Add Holiday'} eyebrow="HOLIDAY CALENDAR" onClose={onClose}><form onSubmit={submit}><div className="modal-content form-grid">
    <Field label="Holiday Name *"><input required className="form-input" value={form.name} onChange={e => set('name', e.target.value)} /></Field><Field label="Date *"><input required type="date" className="form-input" value={form.holiday_date} onChange={e => set('holiday_date', e.target.value)} /></Field>
    <Field label="Type"><select className="form-input" value={form.holiday_type} onChange={e => set('holiday_type', e.target.value)}>{TYPES.map(t => <option key={t} value={t}>{friendly(t)}{t === 'optional' ? ' (not applied to payroll)' : ''}</option>)}</select></Field>
    <Field label="Locations (comma separated, empty = all)"><input className="form-input" value={form.locations} onChange={e => set('locations', e.target.value)} /></Field>
    <Field label="Teams / Departments (empty = all)"><input className="form-input" value={form.teams} onChange={e => set('teams', e.target.value)} /></Field>
    <Field label="Notes" wide><input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
    {error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Holiday'}</button></div></form></Modal>;
}
