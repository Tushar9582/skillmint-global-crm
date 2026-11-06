'use client';

import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { friendly } from '@/lib/client-api';
import { KIND_LABELS, OPTION_KINDS, type OptionKind } from '@/lib/hr/crm-config';
import { Badge, Denied, ErrorNote, Field, Modal, PageHeading, Tabs, send, useApi, type Row } from './ui';
import { invalidateCrmConfig } from './use-crm-config';
import { useCurrentUser } from '../workspace-shell';

type Tab = 'lists' | 'fields' | 'workflow';

export function CrmConfigPage() {
  const user = useCurrentUser(); const [tab, setTab] = useState<Tab>('lists');
  if (user.role !== 'admin') return <Denied />;
  return <div className="page-shell"><PageHeading eyebrow="RECRUITMENT CRM / ADMINISTRATION" title="CRM Customization" subtitle="Admin-controlled pick lists, custom fields and workflow settings. Values are validated on the server and every change is audited." />
    <Tabs tabs={[['lists', 'Pick Lists'], ['fields', 'Custom Fields'], ['workflow', 'Workflow']]} value={tab} onChange={setTab} />
    {tab === 'lists' && <PickLists />}{tab === 'fields' && <CustomFields />}{tab === 'workflow' && <Workflow />}</div>;
}

function PickLists() {
  const api = useApi<{ data: Record<string, Row[]> }>('/api/v1/config/options'); const [kind, setKind] = useState<OptionKind>('company_lead_stage');
  const [label, setLabel] = useState(''); const [error, setError] = useState(''); const [edit, setEdit] = useState<Row | null>(null);
  const rows = api.data?.data[kind] ?? [];
  const changed = () => { invalidateCrmConfig(); api.reload(); };
  async function add(e: FormEvent) { e.preventDefault(); setError(''); try { await send('/api/v1/config/options', 'POST', { kind, label }); setLabel(''); changed(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add'); } }
  async function toggle(o: Row) { setError(''); try { await send(`/api/v1/config/options/${String(o.id)}`, 'PATCH', { active: !o.active }); changed(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update'); } }
  return <div className="stack"><div className="toolbar panel"><Field label="List"><select className="form-input" value={kind} onChange={e => setKind(e.target.value as OptionKind)}>{OPTION_KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></Field></div>
    <div className="alert">System values (marked) back application logic such as lead conversion, resume intake and call counts. They can be relabelled but never removed. Deactivating a value hides it from new records; existing records keep it.</div>
    <ErrorNote message={error || api.error} />
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Label', 'Stored Value', 'Order', 'Type', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map(o => <tr key={String(o.id)} style={{ opacity: o.active ? 1 : 0.55 }}><td><b>{String(o.label)}</b></td><td><code>{String(o.value)}</code></td><td>{String(o.sort_order)}</td><td>{o.is_system ? <Badge value="info" label="System" /> : 'Custom'}</td><td><Badge value={o.active ? 'active' : 'inactive'} /></td>
        <td><div className="row-actions"><button className="table-action" onClick={() => setEdit(o)}>Edit</button>{!o.is_system && <button className="table-action" onClick={() => void toggle(o)}>{o.active ? 'Deactivate' : 'Activate'}</button>}</div></td></tr>)}</tbody></table></div>
      <form className="form-grid" style={{ padding: 22 }} onSubmit={add}><Field label={`Add value to "${KIND_LABELS[kind]}" *`}><input required className="form-input" maxLength={60} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Site Visit" /></Field><div><button className="btn primary"><Plus size={16} /> Add Value</button></div></form></div>
    {edit && <EditOption row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); changed(); }} />}</div>;
}
function EditOption({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(String(row.label)); const [order, setOrder] = useState(String(row.sort_order)); const [error, setError] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await send(`/api/v1/config/options/${String(row.id)}`, 'PATCH', { label, sort_order: order }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <Modal wide={false} title={`Edit ${String(row.value)}`} eyebrow="PICK LIST" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack"><Field label="Label *"><input required maxLength={60} className="form-input" value={label} onChange={e => setLabel(e.target.value)} /></Field>
    <Field label="Sort order"><input type="number" min={0} max={10000} className="form-input" value={order} onChange={e => setOrder(e.target.value)} /></Field>{error && <div className="alert danger">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div></form></Modal>;
}

function CustomFields() {
  const api = useApi<{ data: Row[] }>('/api/v1/config/custom-fields?all=1'); const [edit, setEdit] = useState<Row | null | false>(false);
  const changed = () => { invalidateCrmConfig(); api.reload(); };
  return <div className="stack"><div className="heading-actions"><button className="btn primary" onClick={() => setEdit(null)}><Plus size={16} /> Add Custom Field</button></div><ErrorNote message={api.error} />
    <div className="alert">Custom fields appear on company lead and candidate forms. Their values are validated and stored with the record. Fields are deactivated, never deleted, so existing data is preserved.</div>
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Label', 'Key', 'Applies To', 'Type', 'Options', 'Required', 'Status', ''].map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{api.data?.data.map(f => <tr key={String(f.id)} style={{ opacity: f.active ? 1 : 0.55 }}><td><b>{String(f.label)}</b></td><td><code>{String(f.field_key)}</code></td><td>{friendly(f.entity)}</td><td>{friendly(f.field_type)}</td><td>{((f.options as string[]) ?? []).join(', ') || '—'}</td><td>{f.required ? 'Yes' : 'No'}</td><td><Badge value={f.active ? 'active' : 'inactive'} /></td><td><button className="table-action" onClick={() => setEdit(f)}>Edit</button></td></tr>)}
        {!api.data?.data.length && <tr><td colSpan={8} className="table-empty">No custom fields yet.</td></tr>}</tbody></table></div></div>
    {edit !== false && <FieldForm current={edit} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); changed(); }} />}</div>;
}
function FieldForm({ current, onClose, onSaved }: { current: Row | null; onClose: () => void; onSaved: () => void }) {
  const c: Row = current ?? {}; const edit = Boolean(c.id);
  const [f, setF] = useState({ entity: String(c.entity ?? 'company_leads'), label: String(c.label ?? ''), field_type: String(c.field_type ?? 'text'), options: ((c.options as string[]) ?? []).join(', '), required: Boolean(c.required), active: c.active !== false });
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await send(`/api/v1/config/custom-fields${edit ? `/${String(c.id)}` : ''}`, edit ? 'PATCH' : 'POST', edit ? { label: f.label, required: f.required, active: f.active, ...(c.field_type === 'select' ? { options: f.options } : {}) } : f); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); }
  }
  return <Modal wide={false} title={edit ? `Edit ${String(c.label)}` : 'Add Custom Field'} eyebrow="CUSTOM FIELD" onClose={onClose}><form onSubmit={submit}><div className="modal-content stack">
    {!edit && <Field label="Applies to"><select className="form-input" value={f.entity} onChange={e => setF({ ...f, entity: e.target.value })}><option value="company_leads">Company leads</option><option value="candidates">Candidate leads</option></select></Field>}
    <Field label="Label *"><input required maxLength={60} className="form-input" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} /></Field>
    {!edit && <Field label="Type"><select className="form-input" value={f.field_type} onChange={e => setF({ ...f, field_type: e.target.value })}>{['text', 'number', 'date', 'select'].map(t => <option key={t} value={t}>{friendly(t)}</option>)}</select></Field>}
    {(f.field_type === 'select' || c.field_type === 'select') && <Field label="Options (comma separated) *"><input required className="form-input" value={f.options} onChange={e => setF({ ...f, options: e.target.value })} /></Field>}
    <label><input type="checkbox" checked={f.required} onChange={e => setF({ ...f, required: e.target.checked })} /> Required when creating records</label>
    {edit && <label><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}{error && <div className="alert danger">{error}</div>}</div>
    <div className="modal-footer"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary">Save</button></div></form></Modal>;
}

function Workflow() {
  const api = useApi<{ data: { resume_followup_days: number } }>('/api/v1/config/workflow'); const [days, setDays] = useState(''); const [msg, setMsg] = useState(''); const [error, setError] = useState('');
  async function save(e: FormEvent) { e.preventDefault(); setError(''); setMsg(''); try { await send('/api/v1/config/workflow', 'PATCH', { resume_followup_days: days === '' ? api.data?.data.resume_followup_days : Number(days) }); setMsg('Workflow settings saved.'); api.reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save'); } }
  return <form className="panel" onSubmit={save}><div className="panel-header"><div><h2>Workflow Settings</h2><p>Automation that runs when work is created.</p></div></div>
    <div className="form-grid" style={{ padding: '0 22px 22px' }}><Field label="Screening follow-up after resume intake (days, 0 = none)"><input type="number" min={0} max={30} step={1} className="form-input" value={days === '' ? String(api.data?.data.resume_followup_days ?? '') : days} onChange={e => setDays(e.target.value)} /></Field><div><button className="btn primary">Save</button></div></div>
    <ErrorNote message={error || api.error} />{msg && <div className="alert success" style={{ margin: '0 22px 22px' }}>{msg}</div>}</form>;
}
