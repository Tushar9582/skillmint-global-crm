'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Search, Download, Trash2, UserX, UserCheck } from 'lucide-react';
import { formatDate, friendly, requestJson } from '@/lib/client-api';
import { isDemoClient } from '@/lib/demo-client';
import { ROLES, ROLE_LABELS } from '@/lib/hr/core';
import { Badge, Denied, ErrorNote, Field, Metric, Modal, PageHeading, Tabs, send, useApi, useCan, type Row } from './ui';
import { useCurrentUser } from '../workspace-shell';

const STATUSES = ['probation', 'active', 'notice', 'resigned', 'terminated', 'inactive'];
const DOC_TYPES = ['id_proof', 'address_proof', 'offer_letter', 'contract', 'education', 'experience', 'other'];
type ListResponse = { data: Row[]; departments: string[] };
type Detail = { data: { employee: Row; history: Row[]; documents: Row[]; shift: Row | null } };

const blank: Row = { full_name: '', email: '', phone: '', department: '', designation: '', location: '', joining_date: '', employment_status: 'active', manager_id: '',
  date_of_birth: '', gender: '', marital_status: '', address: '', emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '', create_login: false, login_role: 'employee', temporary_password: '' };

export function EmployeeDirectoryPage() {
  const can = useCan();
  const user = useCurrentUser();
  const [q, setQ] = useState(''); const [department, setDepartment] = useState(''); const [status, setStatus] = useState(''); const [active, setActive] = useState('true');
  const query = useMemo(() => { const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (department) p.set('department', department); if (status) p.set('status', status); if (active) p.set('active', active); return p.toString(); }, [q, department, status, active]);
  const list = useApi<ListResponse>(can('employees.view') ? `/api/v1/hr/employees?${query}` : null);
  const [editing, setEditing] = useState<Row | null | false>(false);
  const [viewing, setViewing] = useState<string | null>(null);
  if (!can('employees.view')) return <Denied />;
  const rows = list.data?.data ?? [];
  return <div className="page-shell">
    <PageHeading eyebrow="HUMAN RESOURCES / PEOPLE" title="Employee Directory" subtitle="HR profiles, reporting lines, documents and employment history. Separate from candidate records."
      actions={can('employees.manage') && <button className="btn primary" onClick={() => setEditing({ ...blank })}><Plus size={16} /> Add Employee</button>} />
    <div className="metric-grid">
      <Metric label="Employees" value={rows.length} note="Matching current filters" />
      <Metric label="Active" value={rows.filter(r => r.active).length} />
      <Metric label="On Probation" value={rows.filter(r => r.employment_status === 'probation').length} />
      <Metric label="Departments" value={list.data?.departments.length ?? 0} />
    </div>
    <div className="toolbar panel">
      <div className="toolbar-search"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, phone or employee ID…" /></div>
      <select value={department} onChange={e => setDepartment(e.target.value)} aria-label="Department"><option value="">All Departments</option>{list.data?.departments.map(d => <option key={d}>{d}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status"><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{friendly(s)}</option>)}</select>
      <select value={active} onChange={e => setActive(e.target.value)} aria-label="Active"><option value="true">Active only</option><option value="false">Deactivated only</option><option value="">Everyone</option></select>
    </div>
    <ErrorNote message={list.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Employee ID', 'Name', 'Department', 'Designation', 'Reporting Manager', 'Joined', 'Status', 'Action'].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{list.loading ? <tr><td colSpan={8} className="table-empty">Loading employees…</td></tr> : !rows.length ? <tr><td colSpan={8} className="table-empty">No employees match these filters.</td></tr> :
        rows.map(r => <tr key={String(r.id)}><td>{String(r.employee_code)}</td><td><button className="record-link" onClick={() => setViewing(String(r.id))}>{String(r.full_name)}</button><br /><small className="muted">{String(r.email || '')}</small></td>
          <td>{String(r.department || '—')}</td><td>{String(r.designation || '—')}</td><td>{String(r.manager_name || '—')}</td><td>{formatDate(r.joining_date)}</td>
          <td><Badge value={r.employment_status} /></td><td><div className="row-actions"><button className="table-action" onClick={() => setViewing(String(r.id))}>View</button>{can('employees.manage') && <button className="table-action" onClick={() => setEditing(r)}>Edit</button>}</div></td></tr>)}</tbody></table></div></div>
    {editing !== false && <EmployeeForm current={editing} employees={rows} canCreateLogin={user.role === 'admin'} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); list.reload(); }} />}
    {viewing && <EmployeeDetail id={viewing} onClose={() => setViewing(null)} onChanged={list.reload} onEdit={row => { setViewing(null); setEditing(row); }} />}
  </div>;
}

function EmployeeForm({ current, employees, canCreateLogin, onClose, onSaved }: { current: Row | null; employees: Row[]; canCreateLogin: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Row>(() => current?.id ? { ...blank, ...Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v ?? ''])) } : { ...blank });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const edit = Boolean(current?.id);
  const set = (key: string, value: unknown) => setForm(p => ({ ...p, [key]: value }));
  const input = (key: string, type = 'text', required = false) => <input className="form-input" type={type} required={required} value={String(form[key] ?? '')} onChange={e => set(key, e.target.value)} />;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const payload: Row = { ...form }; delete payload.id;
      for (const key of Object.keys(payload)) if (payload[key] === '') payload[key] = null;
      if (edit) for (const k of ['employee_code', 'user_id', 'manager_name', 'login_role', 'created_at', 'active', 'create_login', 'temporary_password', 'exit_date']) delete payload[k];
      await send(`/api/v1/hr/employees${edit ? `/${current!.id}` : ''}`, edit ? 'PATCH' : 'POST', payload); onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } finally { setBusy(false); }
  }
  return <Modal title={edit ? `Edit ${String(current!.full_name)}` : 'Add Employee'} eyebrow="HR PROFILE" onClose={onClose}>
    <form onSubmit={submit}><div className="modal-content form-grid">
      <Field label="Full Name *">{input('full_name', 'text', true)}</Field><Field label="Work Email">{input('email', 'email')}</Field>
      <Field label="Phone">{input('phone', 'tel')}</Field><Field label="Joining Date *">{input('joining_date', 'date', true)}</Field>
      <Field label="Department">{input('department')}</Field><Field label="Designation">{input('designation')}</Field>
      <Field label="Work Location">{input('location')}</Field>
      <Field label="Employment Status"><select className="form-input" value={String(form.employment_status)} onChange={e => set('employment_status', e.target.value)}>{STATUSES.map(s => <option key={s} value={s}>{friendly(s)}</option>)}</select></Field>
      <Field label="Reporting Manager"><select className="form-input" value={String(form.manager_id ?? '')} onChange={e => set('manager_id', e.target.value)}><option value="">None</option>{employees.filter(m => m.active && m.id !== current?.id).map(m => <option key={String(m.id)} value={String(m.id)}>{String(m.full_name)} ({String(m.employee_code)})</option>)}</select></Field>
      <Field label="Date of Birth">{input('date_of_birth', 'date')}</Field>
      <Field label="Gender"><select className="form-input" value={String(form.gender ?? '')} onChange={e => set('gender', e.target.value)}><option value="">Not specified</option>{['female', 'male', 'other'].map(g => <option key={g} value={g}>{friendly(g)}</option>)}</select></Field>
      <Field label="Marital Status"><select className="form-input" value={String(form.marital_status ?? '')} onChange={e => set('marital_status', e.target.value)}><option value="">Not specified</option>{['single', 'married', 'other'].map(g => <option key={g} value={g}>{friendly(g)}</option>)}</select></Field>
      <Field label="Address" wide><textarea className="form-input" rows={2} value={String(form.address ?? '')} onChange={e => set('address', e.target.value)} /></Field>
      <Field label="Emergency Contact Name">{input('emergency_contact_name')}</Field><Field label="Relationship">{input('emergency_contact_relation')}</Field>
      <Field label="Emergency Contact Phone">{input('emergency_contact_phone', 'tel')}</Field>
      {!edit && canCreateLogin && <>
        <Field label="Create login account" wide><span><input type="checkbox" checked={Boolean(form.create_login)} onChange={e => set('create_login', e.target.checked)} /> Allow this employee to sign in (Administrator only)</span></Field>
        {Boolean(form.create_login) && <><Field label="Access Role"><select className="form-input" value={String(form.login_role)} onChange={e => set('login_role', e.target.value)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
          <Field label="Temporary Password (12+ characters)"><input className="form-input" type="password" minLength={12} value={String(form.temporary_password)} onChange={e => set('temporary_password', e.target.value)} /></Field></>}
      </>}
    </div>{error && <div className="alert danger modal-error">{error}</div>}
      <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save Changes' : 'Create Employee'}</button></div></form>
  </Modal>;
}

function EmployeeDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (row: Row) => void }) {
  const can = useCan(); const me = useCurrentUser();
  const api = useApi<Detail>(`/api/v1/hr/employees/${id}`);
  const [tab, setTab] = useState<'profile' | 'history' | 'documents'>('profile');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [docType, setDocType] = useState('id_proof'); const [title, setTitle] = useState(''); const [file, setFile] = useState<File | null>(null);
  const e = api.data?.data.employee;
  async function setStatus(status: string) {
    if (!e || !window.confirm(`${status === 'inactive' ? 'Deactivate' : 'Reactivate'} ${String(e.full_name)}? ${status === 'inactive' ? 'Their login access will be disabled; records are kept.' : ''}`)) return;
    setBusy(true); setError('');
    try { await send(`/api/v1/hr/employees/${id}`, 'PATCH', { employment_status: status }); api.reload(); onChanged(); } catch (err) { setError(err instanceof Error ? err.message : 'Update failed'); } finally { setBusy(false); }
  }
  async function upload(ev: FormEvent) {
    ev.preventDefault(); if (!file) return; setBusy(true); setError('');
    try { const form = new FormData(); form.set('file', file); form.set('doc_type', docType); form.set('title', title || file.name); await requestJson(`/api/v1/hr/employees/${id}/documents`, { method: 'POST', body: form }); setFile(null); setTitle(''); api.reload(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload failed'); } finally { setBusy(false); }
  }
  async function removeDoc(docId: string) { if (!window.confirm('Archive this document?')) return; try { await send(`/api/v1/hr/employees/${id}/documents/${docId}`, 'DELETE'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } }
  const kv = (label: string, value: unknown) => <div key={label}><small>{label}</small><strong>{value === null || value === undefined || value === '' ? '—' : String(value)}</strong></div>;
  return <Modal drawer title={e ? String(e.full_name) : 'Employee'} eyebrow={e ? `${String(e.employee_code)} · EMPLOYEE PROFILE` : 'EMPLOYEE'} onClose={onClose}
    footer={<>{e && can('employees.manage') && (e.active ? (e.user_id !== me.id && <button className="btn ghost" disabled={busy} onClick={() => void setStatus('inactive')}><UserX size={16} /> Deactivate</button>) : <button className="btn ghost" disabled={busy} onClick={() => void setStatus('active')}><UserCheck size={16} /> Reactivate</button>)}
      <button className="btn ghost" onClick={onClose}>Close</button>{e && can('employees.manage') && <button className="btn primary" onClick={() => onEdit(e)}>Edit</button>}</>}>
    <div className="detail-content">
      <ErrorNote message={error || api.error} />{!e ? <p>Loading…</p> : <>
        <div className="row-actions"><Badge value={e.employment_status} />{Boolean(e.login_role) && <span className="status-badge tone-info">Login: {friendly(e.login_role)}</span>}</div>
        <Tabs tabs={[['profile', 'Profile'], ['history', 'Employment History'], ['documents', 'Documents']]} value={tab} onChange={setTab} />
        {tab === 'profile' && <div className="kv-grid">{[['Email', e.email], ['Phone', e.phone], ['Department', e.department], ['Designation', e.designation], ['Location', e.location], ['Reporting Manager', e.manager_name],
          ['Joining Date', formatDate(e.joining_date)], ['Exit Date', e.exit_date ? formatDate(e.exit_date) : null], ['Assigned Shift', api.data?.data.shift ? `${String(api.data.data.shift.name)} (${String(api.data.data.shift.start_time)}–${String(api.data.data.shift.end_time)})` : 'Company default'],
          ['Date of Birth', e.date_of_birth ? formatDate(e.date_of_birth) : null], ['Gender', friendly(e.gender)], ['Marital Status', friendly(e.marital_status)], ['Address', e.address],
          ['Emergency Contact', [e.emergency_contact_name, e.emergency_contact_relation].filter(Boolean).join(' · ')], ['Emergency Phone', e.emergency_contact_phone]].map(([l, v]) => kv(String(l), v))}</div>}
        {tab === 'history' && <div className="stack">{api.data!.data.history.length ? api.data!.data.history.map(h => <div className="activity-entry" key={String(h.id)}><b>{friendly(h.event_type)}</b><small>{formatDate(h.effective_date || h.created_at, true)}</small><p>{Object.entries((h.details ?? {}) as Row).map(([k, v]) => `${friendly(k)}: ${String(v ?? '—')}`).join(' · ')}</p></div>) : <p className="muted">No history recorded yet.</p>}</div>}
        {tab === 'documents' && <div className="stack">
          {api.data!.data.documents.length ? api.data!.data.documents.map(d => <div className="activity-entry" key={String(d.id)}><b>{String(d.title)}</b> <Badge value={d.doc_type} /><small>{String(d.original_filename)} · {formatDate(d.created_at, true)}</small>
            <div className="row-actions">{isDemoClient() ? <small>(demo: file content is not stored)</small> : <a className="file-link" href={`/api/v1/hr/employees/${id}/documents/${String(d.id)}`}><Download size={15} /> Download</a>}{can('documents.manage') && <button className="table-action" onClick={() => void removeDoc(String(d.id))}><Trash2 size={13} /> Archive</button>}</div></div>) : <p className="muted">No documents uploaded.</p>}
          {can('documents.manage') && <form className="form-grid" onSubmit={upload}><Field label="Document Type"><select className="form-input" value={docType} onChange={ev => setDocType(ev.target.value)}>{DOC_TYPES.map(t => <option key={t} value={t}>{friendly(t)}</option>)}</select></Field>
            <Field label="Title"><input className="form-input" value={title} onChange={ev => setTitle(ev.target.value)} /></Field><Field label="File (PDF, PNG or JPG, max 5 MB)" wide><input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={ev => setFile(ev.target.files?.[0] ?? null)} /></Field>
            <button className="btn soft" disabled={!file || busy}>Upload Document</button></form>}
        </div>}
      </>}
    </div>
  </Modal>;
}
