'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, LogIn, LogOut, Plus } from 'lucide-react';
import { downloadFile, formatDate, friendly } from '@/lib/client-api';
import { localDate } from '@/lib/hr/time';
import { Badge, Denied, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, fmtMinutes, fmtTime, send, shiftMonth, thisMonth, useApi, useCan, type Row } from './ui';

type Me = { data: { today: string; server_time: string; timezone: string; record: Row | null; punched_in: boolean; shift: Row & { scheduled_minutes: number } } };
type Day = { date: string; day_type: string; status: string; leave: Row | null; record: Row | null };

const LEGEND: Array<[string, string]> = [['Present', '#bfe9dd'], ['Half day / pending', '#f1dca7'], ['Absent / missing punch', '#f2c5bf'], ['Leave / holiday / weekly off', '#c9ddf1']];

export function AttendanceCalendar({ employeeId }: { employeeId?: string }) {
  const [month, setMonth] = useState(thisMonth());
  const api = useApi<{ data: Day[]; employee: Row; month: string }>(`/api/v1/hr/attendance/calendar?month=${month}${employeeId ? `&employee_id=${employeeId}` : ''}`);
  const days = api.data?.data ?? [];
  const lead = days.length ? new Date(`${days[0].date}T00:00:00Z`).getUTCDay() : 0;
  const todayStr = localDate(new Date());
  return <div className="panel"><div className="panel-header"><div><h2>Attendance Calendar</h2><p>{String(api.data?.employee?.full_name ?? '')}</p></div>
    <div className="month-nav"><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft size={15} /></button><strong>{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong><button className="btn ghost small" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight size={15} /></button></div></div>
    <div className="stack" style={{ padding: '0 22px 22px' }}><ErrorNote message={api.error} />
      <div className="cal-head">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}</div>
      <div className="cal-grid">{Array.from({ length: lead }, (_, i) => <div key={`b${i}`} className="cal-cell blank" />)}
        {days.map(d => <div key={d.date} className={`cal-cell s-${d.status} ${d.date === todayStr ? 'today' : ''}`} title={friendly(d.status)}><b>{Number(d.date.slice(8))}</b><span>{friendly(d.status)}</span>
          {d.record?.punch_in ? <small>{fmtTime(d.record.punch_in)}–{d.record.punch_out ? fmtTime(d.record.punch_out) : '…'}</small> : null}</div>)}</div>
      <div className="legend">{LEGEND.map(([label, color]) => <span key={label} style={{ ['--c' as string]: color }}>{label}</span>)}</div></div></div>;
}

export function MyAttendancePage() {
  const api = useApi<Me>('/api/v1/hr/attendance/me');
  const [month] = useState(thisMonth());
  const history = useApi<{ data: Row[]; timezone: string }>(`/api/v1/hr/attendance?from=${month}-01&to=${month}-31`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [skew, setSkew] = useState(0); const [tick, setTick] = useState(Date.now());
  const info = api.data?.data;
  useEffect(() => { if (info) setSkew(new Date(info.server_time).getTime() - Date.now()); }, [info]);
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  const now = new Date(tick + skew); const tz = info?.timezone ?? 'Asia/Kolkata';
  const live = info?.record?.punch_in && !info.record.punch_out ? Math.max(0, Math.round((now.getTime() - new Date(String(info.record.punch_in)).getTime()) / 60000)) : Number(info?.record?.worked_minutes ?? 0);
  async function punch(action: 'in' | 'out') {
    setBusy(true); setError(''); setMessage('');
    try { const r = await send<{ message: string }>('/api/v1/hr/attendance/punch', 'POST', { action }); setMessage(r.message); api.reload(); history.reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Punch failed'); } finally { setBusy(false); }
  }
  const done = Boolean(info?.record?.punch_out);
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / ATTENDANCE" title="My Attendance" subtitle="Punch times are recorded by the server in the company time zone." />
    <ErrorNote message={error || api.error} />{message && <div className="alert success">{message}</div>}
    <div className="panel punch-card"><div><small className="muted">{now.toLocaleDateString('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })}</small>
      <div className="punch-clock">{now.toLocaleTimeString('en-GB', { timeZone: tz })}</div>
      <p className="muted">Shift: {info ? `${String(info.shift.name ?? 'General')} · ${String(info.shift.start_time)}–${String(info.shift.end_time)}` : '…'}</p>
      <div className="punch-actions"><button className="btn primary" disabled={busy || !info || info.punched_in || done} onClick={() => void punch('in')}><LogIn size={17} /> Punch In</button>
        <button className="btn ghost" disabled={busy || !info?.punched_in} onClick={() => void punch('out')}><LogOut size={17} /> Punch Out</button></div>
      {done && <p className="muted">Today&apos;s attendance is complete. Contact HR for corrections.</p>}</div>
      <div className="punch-facts"><div><small>Status</small><strong>{info?.record ? <Badge value={info.record.status} /> : 'Not punched in'}</strong></div><div><small>Working hours</small><strong>{fmtMinutes(live)}</strong></div>
        <div><small>Punch in</small><strong>{fmtTime(info?.record?.punch_in, tz)}</strong></div><div><small>Punch out</small><strong>{fmtTime(info?.record?.punch_out, tz)}</strong></div>
        <div><small>Late by</small><strong>{fmtMinutes(info?.record?.late_minutes)}</strong></div><div><small>Scheduled</small><strong>{fmtMinutes(info?.shift.scheduled_minutes)}</strong></div></div></div>
    <AttendanceCalendar />
    <div className="panel table-panel"><div className="panel-header"><h2>Attendance History (this month)</h2></div><div className="table-scroll"><table><thead><tr>{['Date', 'In', 'Out', 'Worked', 'Late', 'Early leave', 'Overtime', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{(history.data?.data ?? []).map(r => <tr key={String(r.id)}><td>{formatDate(r.work_date)}</td><td>{fmtTime(r.punch_in, tz)}</td><td>{fmtTime(r.punch_out, tz)}</td><td>{fmtMinutes(r.worked_minutes)}</td><td>{Number(r.late_minutes) ? `${String(r.late_minutes)} min` : '—'}</td><td>{Number(r.early_minutes) ? `${String(r.early_minutes)} min` : '—'}</td><td>{Number(r.overtime_minutes) ? fmtMinutes(r.overtime_minutes) : '—'}</td><td><Badge value={r.status} /></td></tr>)}
        {!history.data?.data.length && <tr><td colSpan={8} className="table-empty">No attendance recorded this month.</td></tr>}</tbody></table></div></div></div>;
}

export function AttendanceRegisterPage() {
  const can = useCan();
  const [tab, setTab] = useState<'register' | 'calendar'>('register');
  const [from, setFrom] = useState(`${thisMonth()}-01`); const [to, setTo] = useState(localDate(new Date()));
  const [employee, setEmployee] = useState(''); const [issue, setIssue] = useState(''); const [status, setStatus] = useState(''); const [department, setDepartment] = useState('');
  const [exportMonth, setExportMonth] = useState(thisMonth());
  const [fix, setFix] = useState<Row | 'new' | null>(null); const [error, setError] = useState('');
  const query = useMemo(() => { const p = new URLSearchParams({ from, to }); if (employee) p.set('employee_id', employee); if (issue) p.set('issue', issue); if (status) p.set('status', status); if (department) p.set('department', department); return p.toString(); }, [from, to, employee, issue, status, department]);
  const allowed = can('attendance.view_all');
  const register = useApi<{ data: Row[]; timezone: string }>(allowed ? `/api/v1/hr/attendance?${query}` : null);
  const today = useApi<{ data: Row[]; summary: Record<string, number>; date: string }>(allowed ? '/api/v1/hr/attendance/today' : null);
  const emps = useApi<{ data: Row[]; departments: string[] }>(allowed ? '/api/v1/hr/employees?active=true' : null);
  if (!allowed) return <Denied />;
  const tz = register.data?.timezone ?? 'Asia/Kolkata'; const s = today.data?.summary;
  return <div className="page-shell"><PageHeading eyebrow="HUMAN RESOURCES / ATTENDANCE" title="Attendance Register" subtitle="All-employee attendance, exceptions, corrections and monthly export."
    actions={<>{can('attendance.correct') && <button className="btn ghost" onClick={() => setFix('new')}><Plus size={16} /> Add Missing Entry</button>}
      <input type="month" className="form-input" value={exportMonth} onChange={e => setExportMonth(e.target.value)} aria-label="Export month" style={{ width: 160 }} />
      <button className="btn primary" onClick={() => void downloadFile(`/api/v1/hr/attendance/export?month=${exportMonth}`, `attendance-${exportMonth}.csv`).catch(e => setError(e.message))}><Download size={16} /> Export Month</button></>} />
    <ErrorNote message={error || register.error} />
    <div className="metric-grid"><Metric label="Present Today" value={s?.present ?? '—'} note={today.data ? formatDate(today.data.date) : ''} /><Metric label="Absent / Not Punched" value={s?.absent ?? '—'} /><Metric label="On Leave" value={s?.on_leave ?? '—'} /><Metric label="Missing Punch-outs" value={s?.missing_punch ?? '—'} /></div>
    <Tabs tabs={[['register', 'Register'], ['calendar', 'Employee Calendar']]} value={tab} onChange={setTab} />
    {tab === 'calendar' ? <div className="stack"><div className="toolbar panel"><select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Select employee…</option>{emps.data?.data.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></div>{employee ? <AttendanceCalendar employeeId={employee} /> : <div className="alert">Select an employee to view their calendar.</div>}</div> : <>
      <div className="toolbar panel"><Field label="From"><input type="date" className="form-input" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="To"><input type="date" className="form-input" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <select value={employee} onChange={e => setEmployee(e.target.value)}><option value="">All employees</option>{emps.data?.data.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select>
        <select value={department} onChange={e => setDepartment(e.target.value)}><option value="">All departments</option>{emps.data?.departments.map(d => <option key={d}>{d}</option>)}</select>
        <select value={issue} onChange={e => setIssue(e.target.value)}><option value="">All records</option><option value="late">Late arrivals</option><option value="early">Early departures</option><option value="missing">Missing punches</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Any status</option>{['present', 'half_day', 'absent', 'missing_punch', 'in_progress'].map(x => <option key={x} value={x}>{friendly(x)}</option>)}</select></div>
      <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Date', 'Employee', 'Department', 'In', 'Out', 'Worked', 'Late', 'Early', 'OT', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{register.loading ? <tr><td colSpan={11} className="table-empty">Loading…</td></tr> : !register.data?.data.length ? <tr><td colSpan={11} className="table-empty">No attendance records match the filters.</td></tr> :
          register.data.data.map(r => <tr key={String(r.id)}><td>{formatDate(r.work_date)}</td><td><b>{String(r.employee_name)}</b><br /><small className="muted">{String(r.employee_code)}</small></td><td>{String(r.department || '—')}</td>
            <td>{fmtTime(r.punch_in, tz)}</td><td>{fmtTime(r.punch_out, tz)}</td><td>{fmtMinutes(r.worked_minutes)}</td><td>{Number(r.late_minutes) ? `${String(r.late_minutes)}m` : '—'}</td><td>{Number(r.early_minutes) ? `${String(r.early_minutes)}m` : '—'}</td><td>{Number(r.overtime_minutes) ? fmtMinutes(r.overtime_minutes) : '—'}</td>
            <td><Badge value={r.status} />{r.source === 'correction' && <small className="muted"> corrected</small>}</td><td>{can('attendance.correct') && <button className="table-action" onClick={() => setFix(r)}>Correct</button>}</td></tr>)}</tbody></table></div></div></>}
    {fix && <CorrectionModal record={fix === 'new' ? null : fix} employees={emps.data?.data ?? []} tz={tz} onClose={() => setFix(null)} onSaved={() => { setFix(null); register.reload(); today.reload(); }} />}
  </div>;
}

function CorrectionModal({ record, employees, tz, onClose, onSaved }: { record: Row | null; employees: Row[]; tz: string; onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState(String(record?.employee_id ?? '')); const [date, setDate] = useState(String(record?.work_date ?? localDate(new Date())));
  const [inTime, setIn] = useState(record?.punch_in ? fmtTime(record.punch_in, tz) : ''); const [outTime, setOut] = useState(record?.punch_out ? fmtTime(record.punch_out, tz) : '');
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const history = useApi<{ data: Row[] }>(record ? `/api/v1/hr/attendance/${String(record.id)}/corrections` : null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { if (record) await send(`/api/v1/hr/attendance/${String(record.id)}`, 'PATCH', { in_time: inTime, out_time: outTime || null, reason }); else await send('/api/v1/hr/attendance/manual', 'POST', { employee_id: employeeId, work_date: date, in_time: inTime, out_time: outTime || null, reason }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); }
  }
  return <Modal title={record ? `Correct attendance · ${String(record.employee_name)} · ${formatDate(record.work_date)}` : 'Add Missing Attendance'} eyebrow="ATTENDANCE CORRECTION (AUDITED)" onClose={onClose}>
    <form onSubmit={submit}><div className="modal-content form-grid">
      {!record && <><Field label="Employee *"><select required className="form-input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}><option value="">Select…</option>{employees.map(e => <option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></Field><Field label="Work Date *"><input required type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} /></Field></>}
      <Field label={`Punch In (${tz}) *`}><input required type="time" className="form-input" value={inTime === '—' ? '' : inTime} onChange={e => setIn(e.target.value)} /></Field>
      <Field label="Punch Out (leave empty if missing)"><input type="time" className="form-input" value={outTime === '—' ? '' : outTime} onChange={e => setOut(e.target.value)} /></Field>
      <Field label="Reason for correction *" wide><textarea required className="form-input" rows={2} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {history.data?.data.length ? <div className="span-2"><h3>Correction history</h3>{history.data.data.map(h => <div className="activity-entry" key={String(h.id)}><b>{String(h.corrected_by_name ?? 'HR')}</b><small>{formatDate(h.created_at, true)}</small><p>{String(h.reason)}</p></div>)}</div> : null}
    </div>{error && <div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save Correction'}</button></div></form></Modal>;
}
