'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle, Download, Edit3, FileText, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { CATALOG, type ResourceDefinition, type Field } from '@/lib/catalog';
import { formatDate, friendly, requestJson, toInputDate } from '@/lib/client-api';
import { attachDemoResume, isDemoClient, saveDemoResumeCandidate } from '@/lib/demo-client';
import { ResumeDropzone, type Duplicate, type Extraction, type Row } from './resume-upload';
import { useCrmConfig } from './hr/use-crm-config';
import { useCurrentUser } from './workspace-shell';

type Option={id:string;label:string};
type Lookup=Record<string,Option[]>;
const lookupTypes:Record<string,string>={user:'employees',client:'clients',job:'jobs',candidate:'candidates',application:'applications'};

function displayRow(row:Row,field:string,label?:(field:string,value:unknown)=>string) {
  const raw=row[field];
  if(field.includes('_at') || field.includes('_date'))return formatDate(raw,field.includes('_at'));
  if(field==='stage'||field==='status'||field==='priority')return <span className={`status-badge status-${String(raw||'neutral').toLowerCase()}`}>{label?label(field,raw):friendly(raw)}</span>;
  if(Array.isArray(raw))return raw.join(', ')||'—';
  return String(raw??'—');
}

function createLabel(resource:string,row:Row):string {
  if(resource==='employees')return String(row.full_name||row.email||row.id);
  return String(row.company_name||row.full_name||row.title||row.job_title||row.id||'Record');
}

function useLookups(open:boolean):Lookup {
  const user=useCurrentUser();
  const [lookups,setLookups]=useState<Lookup>({});
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;
    Promise.all(Object.entries(lookupTypes).map(async([type,url])=>{
      if(type==='user'&&user.role!=='admin')return [type,[]] as const;
      try {
        const result=await requestJson<{data:Row[]}>(`/api/v1/${url}?limit=100`);
        const options=result.data.map(row=>({id:String(row.id),label:createLabel(url,row)}));
        return [type,options] as const;
      } catch {return [type,[]] as const;}
    })).then(results=>{if(!cancelled)setLookups(Object.fromEntries(results));});
    return ()=>{cancelled=true;};
  },[open,user.role]);
  return lookups;
}

function FieldControl({field,value,onChange,lookups,form}:{field:Field;value:unknown;
  onChange:(value:unknown)=>void;lookups:Lookup;form:Row}) {
  const common={id:`field-${field.name}`,required:field.required,className:'form-input'};
  if(field.type==='textarea')return <textarea {...common} rows={4} value={String(value??'')} onChange={e=>onChange(e.target.value)}/>;
  if(field.type==='select')return <select {...common} value={String(value??'')} onChange={e=>onChange(e.target.value)}>
    <option value="">Select {field.label}</option>{field.options?.map(opt=><option key={opt} value={opt}>{friendly(opt)}</option>)}
  </select>;
  if(['user','client','job','candidate','application'].includes(field.type) || field.name==='target_id') {
    let choices=lookups[field.type]||[];
    if(field.name==='target_id'){
      const type=String(form.target_type||'company_leads');
      choices=lookups[type==='company_leads'?'company-leads':type]||[];
    }
    return <select {...common} value={String(value??'')} onChange={e=>onChange(e.target.value)}>
      <option value="">Select {field.label}</option>{choices.map(opt=><option key={opt.id} value={opt.id}>{opt.label}</option>)}
    </select>;
  }
  const type=field.type==='skills'?'text':field.type;
  const fieldValue=type==='datetime-local'?toInputDate(value):type==='date'?toInputDate(value,true):
    Array.isArray(value)?value.join(', '):String(value??'');
  return <input {...common} type={type} value={fieldValue} step={type==='number'?'any':undefined}
    placeholder={field.type==='skills'?'Java, React, Recruitment':field.label}
    onChange={e=>onChange(e.target.value)}/>;
}

function FormFields({fields,form,setForm,lookups,missing=[]}:{fields:Field[];form:Row;setForm:(update:(previous:Row)=>Row)=>void;lookups:Lookup;missing?:string[]}) {
  return <>{fields.map(field=><label className={`form-field ${field.type==='textarea'?'span-2':''} ${missing.includes(field.name)?'field-missing':''}`} key={field.name} htmlFor={`field-${field.name}`}><span>{field.label}{field.required?' *':''}{missing.includes(field.name)?' — not detected':''}</span><FieldControl field={field} value={form[field.name]} form={form} lookups={lookups} onChange={value=>setForm(p=>({...p,[field.name]:value,...(field.name==='target_type'?{target_id:''}:{})}))}/></label>)}</>;
}

function RecordForm({resource,current,onClose,onSaved,embedded=false}:{resource:string;current:Row|null;onClose:()=>void;onSaved:()=>void;embedded?:boolean}) {
  const cfg=useCrmConfig();
  const def=cfg.configure(resource,CATALOG[resource],current||{});
  const customDefs=cfg.customFields(resource);
  const user=useCurrentUser();
  const [form,setForm]=useState<Row>(current||{});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const lookups=useLookups(true);
  const [companyTargets,setCompanyTargets]=useState<Option[]>([]);
  useEffect(()=>{requestJson<{data:Row[]}>('/api/v1/company-leads?limit=100').then(v=>setCompanyTargets(v.data.map(row=>({id:String(row.id),label:String(row.company_name||row.id)})))).catch(()=>{});},[]);
  const fullLookups={...lookups,'company-leads':companyTargets};
  const fields=def.fields.filter(field=>field.name!=='owner_id'||user.role==='admin');
  async function save(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const values={...form};
      if(customDefs.length){const source=(form.custom as Row|undefined)||{};values.custom=Object.fromEntries(customDefs.map(d=>[d.field_key,source[d.field_key]??'']));}else delete values.custom;
      for(const field of fields) {
        if(field.type==='skills'&&typeof values[field.name]==='string')values[field.name]=String(values[field.name]).split(',').map(v=>v.trim()).filter(Boolean);
      }
      await requestJson(`/api/v1/${resource}${current?`/${current.id}`:''}`,{
        method:current?'PATCH':'POST',body:JSON.stringify(values),
      });
      onSaved();
    } catch(error){setError(error instanceof Error?error.message:'Unable to save');}
    finally{setBusy(false);}
  }
  const formEl=<form onSubmit={save}><div className="modal-content form-grid">
        <FormFields fields={fields} form={form} setForm={setForm} lookups={fullLookups}/>
        {customDefs.map(d=>{const value=((form.custom as Row|undefined)||{})[d.field_key];const set=(next:string)=>setForm(p=>({...p,custom:{...((p.custom as Row|undefined)||{}),[d.field_key]:next}}));
          return <label className="form-field" key={d.field_key}><span>{d.label}{d.required?' *':''}</span>{d.field_type==='select'?<select className="form-input" required={d.required} value={String(value??'')} onChange={e=>set(e.target.value)}><option value="">Select {d.label}</option>{d.options.map(o=><option key={o} value={o}>{o}</option>)}</select>:<input className="form-input" required={d.required} type={d.field_type==='number'?'number':d.field_type==='date'?'date':'text'} step={d.field_type==='number'?'any':undefined} value={String(value??'')} onChange={e=>set(e.target.value)}/>}</label>;})}
      </div>{error&&<div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button disabled={busy} className="btn primary" type="submit">{busy?'Saving…':embedded?'Create Candidate Lead':'Save & Continue'} <ArrowRight size={16}/></button></div></form>;
  if(embedded)return formEl;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal wide" role="dialog" aria-modal="true" aria-label={current?'Edit record':'Create record'}>
      <div className="modal-header"><div><p className="eyebrow">{current?'UPDATE RECORD':'CREATE NEW'}</p><h2>{current?`Edit ${def.singular}`:`Create ${def.singular}`}</h2><p>Required fields are marked with an asterisk.</p></div><button className="icon-only" onClick={onClose} aria-label="Close"><X size={20}/></button></div>
      {formEl}
    </div>
  </div>;
}

const extraFields:Field[]=[{name:'current_designation',label:'Current Designation',type:'text'},{name:'current_company',label:'Current Company',type:'text'},{name:'education',label:'Education / Qualifications',type:'text'}];
const reviewKeys=['full_name','email','phone','location','skills','experience_years','preferred_role','education'];
const prefillKeys=['full_name','email','phone','location','experience_years','expected_ctc','notice_period','preferred_role','current_designation','current_company','education'];

function CandidateIntake({initialTab,onClose,onSaved}:{initialTab:'manual'|'resume';onClose:()=>void;onSaved:()=>void}) {
  const user=useCurrentUser();
  const lookups=useLookups(true);
  const cfg=useCrmConfig();
  const [tab,setTab]=useState(initialTab);
  const [upload,setUpload]=useState<Extraction|null>(null);
  const [form,setForm]=useState<Row>({});
  const [duplicate,setDuplicate]=useState<Duplicate|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const fields=[...cfg.configure('candidates',CATALOG.candidates).fields.filter(f=>f.name!=='source'&&(f.name!=='owner_id'||user.role==='admin')),...extraFields];
  const missing=reviewKeys.filter(key=>{const v=form[key];return v===undefined||v===null||String(v).trim()==='';});
  function extracted(result:Extraction) {
    const next:Row={owner_id:user.id,stage:'new'};
    for(const key of prefillKeys)if(result.parsed[key]!=null)next[key]=result.parsed[key];
    next.skills=Array.isArray(result.parsed.skills)?result.parsed.skills.join(', '):'';
    setForm(next);setUpload(result);setDuplicate(result.duplicate);setError('');
  }
  function reset(){setUpload(null);setForm({});setDuplicate(null);setError('');}
  const owner=()=>user.role==='admin'?String(form.owner_id||user.id):user.id;
  function body(file:File,extra:Record<string,string>) {
    const data=new FormData();data.set('file',file);data.set('owner_id',owner());
    for(const [key,value] of Object.entries(extra))data.set(key,value);
    return data;
  }
  async function confirm() {
    if(!upload)return;
    setBusy(true);setError('');
    try {
      const num=(v:unknown)=>v===''||v==null?null:Number(v);
      const values={...form,skills:String(form.skills||'').split(',').map(s=>s.trim()).filter(Boolean),
        experience_years:num(form.experience_years),expected_ctc:num(form.expected_ctc),source:'resume'};
      let out:{duplicate?:boolean;message?:string;existing_candidate_id?:string|null;existing_candidate_name?:string|null};
      if(isDemoClient())out=saveDemoResumeCandidate(values,{name:upload.file.name,sha256:upload.sha256},owner());
      else {
        const response=await fetch('/api/v1/resumes',{method:'POST',body:body(upload.file,{fields:JSON.stringify(values)})});
        out=await response.json();
        if(!response.ok&&response.status!==409)throw new Error(String((out as {error?:string}).error||'Unable to create candidate'));
      }
      if(out.duplicate){setDuplicate(out);return;}
      onSaved();
    } catch(err){setError(err instanceof Error?err.message:'Unable to create candidate');}
    finally{setBusy(false);}
  }
  async function attach() {
    if(!upload||!duplicate?.existing_candidate_id)return;
    setBusy(true);setError('');
    try {
      if(isDemoClient())attachDemoResume(duplicate.existing_candidate_id,{name:upload.file.name,sha256:upload.sha256});
      else {
        const response=await fetch('/api/v1/resumes',{method:'POST',body:body(upload.file,{candidate_id:duplicate.existing_candidate_id})});
        if(!response.ok){const p=await response.json().catch(()=>({}));throw new Error(String(p.error||p.message||'Unable to attach resume'));}
      }
      onSaved();
    } catch(err){setError(err instanceof Error?err.message:'Unable to attach resume');}
    finally{setBusy(false);}
  }
  const tabButton=(key:'manual'|'resume',label:string)=><button type="button" role="tab" aria-selected={tab===key} className={`btn ${tab===key?'primary':'ghost'}`} onClick={()=>setTab(key)}>{label}</button>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal wide" role="dialog" aria-modal="true" aria-label="Add candidate lead">
      <div className="modal-header"><div><p className="eyebrow">CANDIDATES & RESUME BANK</p><h2>Add Candidate Lead</h2><p>Enter details manually or let a resume pre-fill the form.</p></div><button className="icon-only" onClick={onClose} aria-label="Close"><X size={20}/></button></div>
      <div className="modal-content" role="tablist" style={{display:'flex',gap:8,paddingBottom:0}}>{tabButton('manual','Manual Entry')}{tabButton('resume','Upload Resume')}</div>
      {tab==='manual'?<RecordForm resource="candidates" current={null} embedded onClose={onClose} onSaved={onSaved}/>:
        !upload?<div className="modal-content"><ResumeDropzone onExtracted={extracted}/></div>:
        <div>
          <div className="modal-content">
            <div className="alert"><FileText size={16}/> {upload.file.name} — Candidate Source: <b>Resume</b>. {missing.length?`Please review ${missing.length} highlighted field(s) not found in the resume.`:'All key details were detected; review before saving.'}</div>
            {duplicate&&<div className="alert danger">{duplicate.message||'A candidate with this email or phone already exists.'}{duplicate.existing_candidate_name?` Existing candidate: ${duplicate.existing_candidate_name}.`:''}
              <div className="result-actions">{duplicate.existing_candidate_id&&duplicate.kind!=='exact'&&<button type="button" className="btn soft" disabled={busy} onClick={()=>void attach()}>Attach Resume to Existing Candidate</button>}<button type="button" className="btn ghost" onClick={reset}>Choose Another Resume</button></div></div>}
          </div>
          <div className="modal-content form-grid"><FormFields fields={fields} form={form} setForm={setForm} lookups={lookups} missing={missing}/></div>
          {error&&<div className="alert danger modal-error">{error}</div>}
          <div className="modal-footer"><button className="btn ghost" type="button" onClick={reset}>Change Resume</button><button className="btn primary" type="button" disabled={busy||!String(form.full_name||'').trim()||!!(duplicate&&(duplicate.existing_candidate_id||duplicate.kind==='exact'))} onClick={()=>void confirm()}><CheckCircle size={16}/> {busy?'Saving…':'Confirm & Create Candidate'}</button></div>
        </div>}
    </div>
  </div>;
}

function FollowupCompletion({row,onClose,onDone}:{row:Row;onClose:()=>void;onDone:()=>void}) {
  const channels=useCrmConfig().list('followup_type',['call','email','whatsapp','meeting','other']);
  const [channel,setChannel]=useState('call');
  const [outcome,setOutcome]=useState('connected');
  const [notes,setNotes]=useState('');
  const [next,setNext]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{
    await requestJson(`/api/v1/followups/${row.id}/complete`,{method:'POST',body:JSON.stringify({channel,outcome,notes,next_due_at:next||null})});onDone();
  }catch(err){setError(err instanceof Error?err.message:'Unable to save');}finally{setBusy(false);}}
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">CONTACT OUTCOME</p><h2>Log Follow-up</h2><p>{String(row.title)}</p></div><button className="icon-only" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={submit}><div className="modal-content form-grid">
      <label className="form-field"><span>Channel *</span><select className="form-input" value={channel} onChange={e=>setChannel(e.target.value)}>{channels.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
      <label className="form-field"><span>Outcome *</span><select className="form-input" value={outcome} onChange={e=>setOutcome(e.target.value)}>{['connected','no_answer','interested','not_interested','screened','scheduled','completed','other'].map(x=><option key={x} value={x}>{friendly(x)}</option>)}</select></label>
      <label className="form-field span-2"><span>Discussion Notes</span><textarea className="form-input" value={notes} onChange={e=>setNotes(e.target.value)} rows={4}/></label>
      <label className="form-field span-2"><span>Next Follow-up (optional for closure)</span><input className="form-input" type="datetime-local" value={next} onChange={e=>setNext(e.target.value)}/></label>
    </div>{error&&<div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button disabled={busy} className="btn primary" type="submit">{busy?'Saving…':'Complete Follow-up'}</button></div></form>
  </div></div>;
}

function ActivityForm({resource,row,onClose,onDone}:{resource:string;row:Row;onClose:()=>void;onDone:()=>void}) {
  const channels=useCrmConfig().list('followup_type',['call','email','whatsapp','meeting','other']);
  const [channel,setChannel]=useState('call');const [outcome,setOutcome]=useState('connected');
  const [notes,setNotes]=useState('');const [due,setDue]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{
    await requestJson('/api/v1/activities',{method:'POST',body:JSON.stringify({
      target_type:resource==='company-leads'?'company_leads':resource,target_id:row.id,
      channel,outcome,notes,next_due_at:due||null,
    })});onDone();
  }catch(err){setError(err instanceof Error?err.message:'Unable to log contact');}finally{setBusy(false);}}
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">CONTACT HISTORY</p><h2>Log Call / Follow-up</h2><p>{createLabel(resource,row)}</p></div><button className="icon-only" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={save}><div className="modal-content form-grid"><label className="form-field"><span>Channel</span><select className="form-input" value={channel} onChange={e=>setChannel(e.target.value)}>{channels.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label><label className="form-field"><span>Outcome</span><select className="form-input" value={outcome} onChange={e=>setOutcome(e.target.value)}>{['connected','no_answer','interested','not_interested','screened','scheduled','completed','other'].map(v=><option key={v} value={v}>{friendly(v)}</option>)}</select></label><label className="form-field span-2"><span>Discussion Notes</span><textarea className="form-input" rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><label className="form-field span-2"><span>Next Follow-up Date</span><input type="datetime-local" className="form-input" value={due} onChange={e=>setDue(e.target.value)}/></label></div>{error&&<div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>Save Activity</button></div></form>
  </div></div>;
}

function RecordDetail({resource,row,onClose,onEdit,onComplete,onLog,onConvert,onDelete}:{resource:string;row:Row;onClose:()=>void;onEdit:()=>void;onComplete:()=>void;onLog:()=>void;onConvert:()=>void;onDelete?:()=>void}) {
  const def=CATALOG[resource];
  const cfg=useCrmConfig();
  const [activities,setActivities]=useState<Row[]>([]);
  const [resumes,setResumes]=useState<Row[]>([]);
  const targetType=resource==='company-leads'?'company_leads':resource;
  useEffect(()=>{
    if(['company-leads','candidates','applications'].includes(resource))
      requestJson<{data:Row[]}>(`/api/v1/activities?target_type=${targetType}&target_id=${row.id}`).then(v=>setActivities(v.data)).catch(()=>{});
    if(resource==='candidates')requestJson<{data:Row[]}>(`/api/v1/resumes?candidate_id=${row.id}`).then(v=>setResumes(v.data)).catch(()=>{});
  },[resource,row.id,targetType]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="detail-drawer" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{def.singular.toUpperCase()} / 360 VIEW</p><h2>{createLabel(resource,row)}</h2><p>Record details and immutable activity</p></div><button className="icon-only" onClick={onClose}><X size={20}/></button></div>
    <div className="detail-content"><div className="detail-field-grid">{def.fields.filter(field=>field.name!=='target_id').map(field=><div key={field.name}><small>{field.label}</small><strong>{field.type==='datetime-local'||field.type==='date'?formatDate(row[field.name],field.type==='datetime-local'):(field.name==='stage'||field.name==='priority'||field.name==='source')?cfg.label(resource,field.name,row[field.name]):friendly(row[field.name])}</strong></div>)}{cfg.customFields(resource).map(d=>{const raw=((row.custom as Row|undefined)||{})[d.field_key];return <div key={`custom-${d.field_key}`}><small>{d.label}</small><strong>{raw===undefined||raw===null||raw===''?'—':d.field_type==='date'?formatDate(raw):String(raw)}</strong></div>;})}</div>
      {resource==='candidates'&&<section className="detail-section"><h3>Resume Versions</h3>{resumes.length?resumes.map((file,index)=>{const label=<><FileText size={17}/>v{resumes.length-index} · {String(file.original_filename)} <small>{formatDate(file.created_at,true)}</small></>;return isDemoClient()?<span key={String(file.id)} className="file-link">{label} <small>(demo: file not stored)</small></span>:<a key={String(file.id)} className="file-link" href={`/api/v1/resumes/${file.id}/download`} target="_blank" rel="noreferrer">{label} <Download size={16}/></a>;}):<p>No resume uploaded yet.</p>}</section>}
      {['company-leads','candidates','applications'].includes(resource)&&<section className="detail-section"><h3>Follow-up & Communication History</h3>{activities.length?activities.map(a=><div key={String(a.id)} className="activity-entry"><b>{friendly(a.channel)} · {friendly(a.outcome)}</b><small>{String(a.employee_name)} · {formatDate(a.created_at,true)}</small><p>{String(a.notes||'No notes')}</p></div>):<p>No logged activities yet.</p>}</section>}
    </div><div className="modal-footer"><button className="btn ghost" onClick={onClose}>Close</button>{resource==='followups'&&row.status==='pending'&&<button className="btn soft" onClick={onComplete}><CheckCircle size={16}/> Complete</button>}{['company-leads','candidates','applications'].includes(resource)&&<button className="btn soft" onClick={onLog}>Log Contact</button>}{resource==='company-leads'&&row.stage!=='converted'&&<button className="btn soft" onClick={onConvert}>Convert to Client</button>}{onDelete&&<button className="btn ghost" onClick={onDelete}><Trash2 size={16}/> Delete Lead</button>}<button className="btn primary" onClick={onEdit}><Edit3 size={16}/> Edit</button></div>
  </div></div>;
}

export function DataTablePage({resource}:{resource:string}) {
  const def=CATALOG[resource];
  const cfg=useCrmConfig();
  const labelOf=(field:string,value:unknown)=>cfg.label(resource,field,value);
  const user=useCurrentUser();
  const [rows,setRows]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [stage,setStage]=useState('');
  const [page,setPage]=useState(1);
  const [hasMore,setHasMore]=useState(false);
  const [error,setError]=useState('');
  const [edit,setEdit]=useState<Row|null|false>(false);
  const [intake,setIntake]=useState<'manual'|'resume'|false>(false);
  const [selected,setSelected]=useState<Row|null>(null);
  const [completion,setCompletion]=useState<Row|null>(null);
  const [activity,setActivity]=useState<Row|null>(null);
  const [checked,setChecked]=useState<string[]>([]);
  const [bulkOwner,setBulkOwner]=useState('');
  const [employees,setEmployees]=useState<Option[]>([]);
  const [bulkBusy,setBulkBusy]=useState(false);
  const canBulkAssign=user.role==='admin'&&resource!=='followups';
  const canDelete=user.role==='admin'&&['company-leads','candidates'].includes(resource);
  useEffect(()=>{
    if(!canBulkAssign)return;
    requestJson<{data:Row[]}>('/api/v1/employees').then(r=>setEmployees(r.data
      .filter(e=>e.active).map(e=>({id:String(e.id),label:String(e.full_name)})))).catch(()=>{});
  },[canBulkAssign]);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try {
      const qs=new URLSearchParams({page:String(page),limit:'50'});
      if(search.trim())qs.set('q',search.trim());
      if(stage)qs.set('stage',stage);
      const result=await requestJson<{data:Row[];has_more:boolean}>(`/api/v1/${resource}?${qs}`);
      setRows(result.data);setHasMore(result.has_more);setChecked([]);
    }catch(e){setError(e instanceof Error?e.message:'Cannot load records');}
    finally{setLoading(false);}
  },[resource,search,stage,page]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const q=new URLSearchParams(window.location.search);const candidates=resource==='candidates';if(candidates&&q.get('mode')==='resume')setIntake('resume');else if(q.has('new'))candidates?setIntake('manual'):setEdit(null);if(q.has('q'))setSearch(q.get('q')||'');},[resource]);
  const complete=()=>{setCompletion(null);setSelected(null);void load();};
  const save=()=>{setEdit(false);setSelected(null);void load();};
  const intakeSaved=()=>{setIntake(false);setSearch('');setStage('');setPage(1);void load();};
  async function convertLead(){
    if(!selected||!window.confirm('Convert this company lead to a client account?'))return;
    try{await requestJson(`/api/v1/company-leads/${selected.id}/convert`,{method:'POST'});setSelected(null);void load();}
    catch(err){setError(err instanceof Error?err.message:'Conversion failed');}
  }
  async function bulkAssign(){
    if(!checked.length||!bulkOwner)return;
    if(!window.confirm(`Assign ${checked.length} selected ${def.plural.toLowerCase()} to the chosen recruiter?`))return;
    setBulkBusy(true);setError('');try{
      await requestJson('/api/v1/assignments/bulk',{method:'POST',body:JSON.stringify({
        resource,ids:checked,to_owner:bulkOwner,reason:'Admin selected bulk reassignment',
      })});setBulkOwner('');setChecked([]);await load();
    }catch(err){setError(err instanceof Error?err.message:'Bulk assignment failed');}
    finally{setBulkBusy(false);}
  }
  async function deleteLeads(ids:string[]){
    if(!ids.length)return;const names=ids.map(id=>createLabel(resource,rows.find(row=>String(row.id)===id)||{})).join(', ');
    if(!window.confirm(`Delete ${ids.length} ${def.singular.toLowerCase()} lead(s): ${names}? This affects existing records.`))return;
    setBulkBusy(true);setError('');try{await Promise.all(ids.map(id=>requestJson(`/api/v1/${resource}/${id}`,{method:'DELETE'})));setSelected(null);setChecked([]);await load();}catch(err){setError(err instanceof Error?err.message:'Unable to delete lead.');}finally{setBulkBusy(false);}
  }
  return <div className="page-shell"><div className="page-heading"><div><p className="eyebrow">SKILLMINT / WORKSPACE</p><h1>{def.plural}</h1><p>{def.description}</p></div><div className="heading-actions">{user.role==='admin'&&<a href={`/api/v1/export?resource=${resource}`} className="btn ghost"><Download size={16}/> Export CSV</a>}<button onClick={()=>resource==='candidates'?setIntake('manual'):setEdit(null)} className="btn primary"><Plus size={16}/> Add {def.singular}</button>{resource==='candidates'&&<button onClick={()=>setIntake('resume')} className="btn soft"><UploadCloud size={16}/> Upload Resume</button>}</div></div>
    <div className="toolbar panel"><div className="toolbar-search"><Search size={17}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder={`Search ${def.plural.toLowerCase()}…`}/></div>
      {(()=>{const stages=cfg.stagesFor(resource,def.stages);return stages&&<select value={stage} onChange={e=>{setStage(e.target.value);setPage(1);}}><option value="">All Stages</option>{stages.map(v=><option key={v} value={v}>{cfg.label(resource,'stage',v)}</option>)}</select>;})()}
      <span className="record-count">{rows.length} records on this page</span></div>
    {canBulkAssign&&checked.length>0&&<div className="toolbar panel"><strong>{checked.length} selected</strong><select className="form-input" aria-label="Assign selected records to" value={bulkOwner} onChange={e=>setBulkOwner(e.target.value)}><option value="">Select receiving employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select><button className="btn primary" disabled={!bulkOwner||bulkBusy} onClick={bulkAssign}>{bulkBusy?'Assigning…':'Assign Selected'}</button>{canDelete&&<button className="btn ghost" disabled={bulkBusy} onClick={()=>void deleteLeads(checked)}><Trash2 size={16}/> Delete Selected</button>}<button className="btn ghost" onClick={()=>setChecked([])}>Clear</button></div>}
    {error&&<div className="alert danger">{error}</div>}
    <div className="table-panel panel"><div className="panel-header"><h2>All Records</h2><span className="muted">Select a row to view details</span></div><div className="table-scroll"><table><thead><tr>{canBulkAssign&&<th><input type="checkbox" aria-label="Select all on this page" checked={rows.length>0&&checked.length===rows.length} onChange={e=>setChecked(e.target.checked?rows.map(row=>String(row.id)):[])}/></th>}{def.columns.map(col=><th key={col}>{friendly(col)}</th>)}<th>Action</th></tr></thead><tbody>{loading?<tr><td colSpan={def.columns.length+1+Number(canBulkAssign)} className="table-empty">Loading records…</td></tr>:rows.length===0?<tr><td colSpan={def.columns.length+1+Number(canBulkAssign)} className="table-empty">No records yet. Create your first {def.singular.toLowerCase()}.</td></tr>:rows.map(row=><tr key={String(row.id)}>{canBulkAssign&&<td><input type="checkbox" aria-label={`Select ${createLabel(resource,row)}`} checked={checked.includes(String(row.id))} onChange={e=>setChecked(old=>e.target.checked?[...old,String(row.id)]:old.filter(id=>id!==row.id))}/></td>}{def.columns.map((col,index)=><td key={col}>{index===0?<button className="record-link" onClick={()=>setSelected(row)}>{displayRow(row,col,labelOf)}</button>:displayRow(row,col,labelOf)}</td>)}<td><button className="table-action" onClick={()=>resource==='followups'&&row.status==='pending'?setCompletion(row):setSelected(row)}>{resource==='followups'&&row.status==='pending'?'Log':'View'} <ArrowRight size={13}/></button>{canDelete&&<button className="table-action" onClick={()=>void deleteLeads([String(row.id)])}><Trash2 size={13}/> Delete</button>}</td></tr>)}</tbody></table></div>
      <div className="table-footer"><span>Page {page}</span><div><button disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}><ArrowLeft size={15}/> Prev</button><button disabled={!hasMore||loading} onClick={()=>setPage(x=>x+1)}>Next <ArrowRight size={15}/></button></div></div>
    </div>
    {edit!==false&&<RecordForm resource={resource} current={edit} onClose={()=>setEdit(false)} onSaved={save}/>}
    {intake&&<CandidateIntake initialTab={intake} onClose={()=>setIntake(false)} onSaved={intakeSaved}/>}
    {selected&&<RecordDetail resource={resource} row={selected} onClose={()=>setSelected(null)} onEdit={()=>{setEdit(selected);setSelected(null);}} onComplete={()=>{setCompletion(selected);setSelected(null);}} onLog={()=>{setActivity(selected);setSelected(null);}} onConvert={()=>{void convertLead();}} onDelete={canDelete?()=>void deleteLeads([String(selected.id)]):undefined}/>} 
    {completion&&<FollowupCompletion row={completion} onClose={()=>setCompletion(null)} onDone={complete}/>}
    {activity&&<ActivityForm resource={resource} row={activity} onClose={()=>setActivity(null)} onDone={()=>{setActivity(null);void load();}}/>}
  </div>;
}
