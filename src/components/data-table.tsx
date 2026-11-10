'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle, Download, Edit3, Eye, FileText, Plus, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { CATALOG, type ResourceDefinition, type Field } from '@/lib/catalog';
import { formatDate, friendly, requestJson, toInputDate } from '@/lib/client-api';
import { attachDemoResume, isDemoClient, saveDemoResumeCandidate } from '@/lib/demo-client';
import { loadDemoResumeFile } from '@/lib/demo-resume-storage';
import { ResumeDropzone, type Duplicate, type Extraction, type Row } from './resume-upload';
import { useCrmConfig } from './hr/use-crm-config';
import { useCurrentUser } from './workspace-shell';
import { LeadAssignmentPanel } from './lead-assignment-panel';
import { isLeadResource } from '@/lib/lead-operations';

type Option={id:string;label:string};
type Lookup=Record<string,Option[]>;
const lookupTypes:Record<string,string>={user:'employees',client:'clients',job:'jobs',candidate:'candidates',application:'applications'};

function displayRow(row:Row,field:string,label?:(field:string,value:unknown)=>string) {
  const raw=row[field];
  if(field.includes('_at') || field.includes('_date'))return formatDate(raw,field.includes('_at'));
  if(field==='stage'||field==='status'||field==='priority')return <span className={`status-badge status-${String(raw||'neutral').toLowerCase()}`}>{label?label(field,raw):friendly(raw)}</span>;
  if(field==='skills'){
    const skills=Array.isArray(raw)?raw.join(', '):String(raw??'');
    return <span className="skills-preview" title={skills}>{skills||'—'}</span>;
  }
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
        {!current&&resource==='applications'&&<div className="crm-form-guidance"><strong>Candidate + Job = Application</strong><span>Select an existing candidate and a job requirement below. Missing one?</span><div><Link href="/candidates?new=1">Add Candidate</Link><Link href="/jobs?new=1">Add Job Requirement</Link></div></div>}
        {!current&&resource==='jobs'&&<div className="crm-form-guidance"><strong>Connect the vacancy to an employer</strong><span>Each job needs a client account. Use an existing client below, or create one.</span><div><Link href="/clients?new=1">Create Client Account</Link><Link href="/company-leads">Go to Company Leads</Link></div></div>}
        {!current&&resource==='interviews'&&<div className="crm-form-guidance"><strong>Schedule for an application</strong><span>Select a candidate application below. You can create one first if needed.</span><div><Link href="/applications?new=1">Add Application</Link></div></div>}
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
      if(isDemoClient())out=await saveDemoResumeCandidate(values,upload.file,upload.sha256,owner());
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
      if(isDemoClient())await attachDemoResume(duplicate.existing_candidate_id,upload.file,upload.sha256);
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
    await requestJson(`/api/v1/followups/${row.id}/complete`,{method:'POST',body:JSON.stringify({channel,outcome,notes,next_due_at:next?new Date(`${next}:00+05:30`).toISOString():null})});onDone();
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

function ActivityForm({resource,row,onClose,onDone,initialChannel='call'}:{resource:string;row:Row;onClose:()=>void;onDone:()=>void;initialChannel?:string}) {
  const channels=useCrmConfig().list('followup_type',['call','email','whatsapp','meeting','other']);
  const [channel,setChannel]=useState(initialChannel);const [outcome,setOutcome]=useState(initialChannel==='meeting'?'scheduled':'connected');
  const [notes,setNotes]=useState('');const [due,setDue]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{
    await requestJson('/api/v1/activities',{method:'POST',body:JSON.stringify({
      target_type:resource==='company-leads'?'company_leads':resource,target_id:row.id,
      channel,outcome,notes,next_due_at:due?new Date(`${due}:00+05:30`).toISOString():null,
    })});onDone();
  }catch(err){setError(err instanceof Error?err.message:'Unable to log contact');}finally{setBusy(false);}}
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">CONTACT HISTORY</p><h2>Log Call / Follow-up</h2><p>{createLabel(resource,row)}</p></div><button className="icon-only" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={save}><div className="modal-content form-grid"><label className="form-field"><span>Channel</span><select className="form-input" value={channel} onChange={e=>{setChannel(e.target.value);if(e.target.value==='meeting')setOutcome('scheduled');}}>{channels.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}</select></label><label className="form-field"><span>Outcome</span><select className="form-input" value={outcome} onChange={e=>setOutcome(e.target.value)}>{['connected','no_answer','interested','not_interested','screened','scheduled','completed','other'].map(v=><option key={v} value={v}>{friendly(v)}</option>)}</select></label><label className="form-field span-2"><span>Discussion Notes / Agenda</span><textarea className="form-input" rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></label><label className="form-field span-2"><span>{channel==='meeting'?'Meeting / Next Follow-up (IST)':'Next Follow-up (IST)'}{channel==='meeting'&&outcome==='scheduled'?' *':''}</span><input type="datetime-local" className="form-input" required={channel==='meeting'&&outcome==='scheduled'} value={due} onChange={e=>setDue(e.target.value)}/></label></div>{error&&<div className="alert danger modal-error">{error}</div>}<div className="modal-footer"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>{busy?'Saving…':channel==='meeting'?'Save Meeting':'Save Activity'}</button></div></form>
  </div></div>;
}

type LeadTimeline={
  stages:Row[];assignments:Row[];followups:Row[];interviews:Row[];
};

function RecordDetail({resource,row,onClose,onEdit,onComplete,onLog,onMeeting,onConvert,onDelete,onUpdated}:{resource:string;row:Row;onClose:()=>void;onEdit:()=>void;onComplete:()=>void;onLog:()=>void;onMeeting:()=>void;onConvert:()=>void;onDelete?:()=>void;onUpdated:(record:Row)=>void}) {
  const def=CATALOG[resource];
  const cfg=useCrmConfig();
  const user=useCurrentUser();
  const [activities,setActivities]=useState<Row[]>([]);
  const [timeline,setTimeline]=useState<LeadTimeline|null>(null);
  const [stageChoice,setStageChoice]=useState(String(row.stage||''));
  const [stageBusy,setStageBusy]=useState(false);
  const [stageError,setStageError]=useState('');
  const [stageSaved,setStageSaved]=useState('');
  const [resumes,setResumes]=useState<Row[]>([]);
  const [resumeBusy,setResumeBusy]=useState<string|null>(null);
  const [resumeError,setResumeError]=useState('');
  const targetType=resource==='company-leads'?'company_leads':resource;
  async function openDemoResume(file:Row,download:boolean){
    const filename=String(file.original_filename||'candidate-resume.pdf');
    const isPdf=/\.pdf$/i.test(filename);
    // Open synchronously within the click so browser popup blockers permit the preview.
    const preview=!download&&isPdf?window.open('about:blank','_blank'):null;
    if(preview)preview.opener=null;
    setResumeBusy(String(file.id));setResumeError('');
    try {
      const saved=await loadDemoResumeFile(String(file.id));
      if(!saved)throw new Error('This resume was added before browser file saving was enabled (or browser data was cleared). Please upload the file again.');
      const mime=isPdf?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const url=URL.createObjectURL(new Blob([saved],{type:mime}));
      if(preview){preview.location.replace(url);setTimeout(()=>URL.revokeObjectURL(url),120_000);}
      else {
        const link=document.createElement('a');link.href=url;link.download=filename;
        document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),10_000);
      }
    } catch(error){preview?.close();setResumeError(error instanceof Error?error.message:'Unable to open resume');}
    finally{setResumeBusy(null);}
  }
  useEffect(()=>{
    if(['company-leads','candidates','applications'].includes(resource))
      requestJson<{data:Row[]}>(`/api/v1/activities?target_type=${targetType}&target_id=${row.id}`).then(v=>setActivities(v.data)).catch(()=>{});
    if(isLeadResource(resource))requestJson<{data:LeadTimeline}>(`/api/v1/lead-timeline?resource=${resource}&id=${row.id}`)
      .then(v=>setTimeline(v.data)).catch(()=>setTimeline(null));
    if(resource==='candidates')requestJson<{data:Row[]}>(`/api/v1/resumes?candidate_id=${row.id}`).then(v=>setResumes(v.data)).catch(()=>{});
  },[resource,row.id,targetType]);
  useEffect(()=>{setStageChoice(String(row.stage||''));},[row.stage]);
  async function updateStage(){
    if(!stageChoice||stageChoice===row.stage)return;
    setStageBusy(true);setStageError('');setStageSaved('');
    try{
      const response=await requestJson<{data:Row}>(`/api/v1/${resource}/${row.id}`,{method:'PATCH',body:JSON.stringify({stage:stageChoice})});
      onUpdated({...row,...response.data});setStageSaved(`Stage moved to ${cfg.label(resource,'stage',stageChoice)}.`);
      const updated=await requestJson<{data:LeadTimeline}>(`/api/v1/lead-timeline?resource=${resource}&id=${row.id}`);
      setTimeline(updated.data);
    }catch(error){setStageError(error instanceof Error?error.message:'Unable to update stage');}
    finally{setStageBusy(false);}
  }
  const upcoming=timeline?.followups.filter(task=>task.status==='pending')||[];
  const stages=cfg.stagesFor(resource,def.stages);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className="detail-drawer" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">{def.singular.toUpperCase()} / 360 VIEW</p><h2>{createLabel(resource,row)}</h2><p>Record details and immutable activity</p></div><button className="icon-only" onClick={onClose}><X size={20}/></button></div>
    <div className="detail-content">
      {isLeadResource(resource)&&<div className="lead-detail-overview"><div className="lead-detail-facts"><div><small>Current Stage</small><strong>{cfg.label(resource,'stage',row.stage)}</strong></div><div><small>Assigned To</small><strong>{String(row.owner_name||'Unassigned')}</strong></div><div><small>Next Task / Meeting</small><strong>{upcoming[0]?formatDate(upcoming[0].due_at,true):'No pending task'}</strong></div></div>
        {stages&&<div className="lead-stage-update"><label htmlFor="lead-stage-select">Update Lead Stage</label><div><select id="lead-stage-select" className="form-input" value={stageChoice} onChange={e=>setStageChoice(e.target.value)}><option value="">Select stage</option>{stages.map(stage=><option key={stage} value={stage}>{cfg.label(resource,'stage',stage)}</option>)}</select><button className="btn primary" disabled={stageBusy||!stageChoice||stageChoice===row.stage} type="button" onClick={()=>void updateStage()}>{stageBusy?'Updating…':'Save Stage'}</button></div></div>}
        {stageError&&<div className="alert danger" role="alert">{stageError}</div>}{stageSaved&&<div className="alert success" role="status">{stageSaved}</div>}
      </div>}
      <div className="detail-field-grid">{def.fields.filter(field=>field.name!=='target_id').map(field=><div key={field.name}><small>{field.label}</small><strong>{field.name==='owner_id'?String(row.owner_name||'Unassigned'):field.type==='datetime-local'||field.type==='date'?formatDate(row[field.name],field.type==='datetime-local'):(field.name==='stage'||field.name==='priority'||field.name==='source')?cfg.label(resource,field.name,row[field.name]):friendly(row[field.name])}</strong></div>)}{cfg.customFields(resource).map(d=>{const raw=((row.custom as Row|undefined)||{})[d.field_key];return <div key={`custom-${d.field_key}`}><small>{d.label}</small><strong>{raw===undefined||raw===null||raw===''?'—':d.field_type==='date'?formatDate(raw):String(raw)}</strong></div>;})}</div>
      {resource==='candidates'&&<section className="detail-section"><h3>Saved Resumes</h3><p className="muted">{isDemoClient()?'Files are saved in this browser only. Clearing site data removes them.':'Files are held in private storage and linked to this candidate.'}</p>{resumeError&&<div className="alert danger" role="alert">{resumeError}</div>}{resumes.length?resumes.map((file,index)=>{const isPdf=/\.pdf$/i.test(String(file.original_filename));const label=<><FileText size={17}/>v{resumes.length-index} · {String(file.original_filename)} <small>{formatDate(file.created_at,true)}</small></>;return <div key={String(file.id)} className="file-link resume-file-row"><span className="resume-file-name">{label}</span><span className="resume-file-actions">{isDemoClient()?<>{isPdf&&<button type="button" className="btn ghost small" disabled={resumeBusy===String(file.id)} onClick={()=>void openDemoResume(file,false)}><Eye size={15}/> Open</button>}<button type="button" className="btn soft small" disabled={resumeBusy===String(file.id)} onClick={()=>void openDemoResume(file,true)}><Download size={15}/> {resumeBusy===String(file.id)?'Loading…':'Download'}</button></>:<>{isPdf&&<a className="btn ghost small" href={`/api/v1/resumes/${file.id}/download?view=1`} target="_blank" rel="noreferrer"><Eye size={15}/> Open</a>}<a className="btn soft small" href={`/api/v1/resumes/${file.id}/download`}><Download size={15}/> Download</a></>}</span></div>;}):<p>No resume uploaded yet. Use Upload Resume to create or attach a candidate file.</p>}</section>}
      {['company-leads','candidates','applications'].includes(resource)&&<section className="detail-section"><h3>Follow-up & Communication History</h3>{activities.length?activities.map(a=><div key={String(a.id)} className="activity-entry"><b>{friendly(a.channel)} · {friendly(a.outcome)}</b><small>{String(a.employee_name)} · {formatDate(a.created_at,true)}</small><p>{String(a.notes||'No notes')}</p></div>):<p>No logged activities yet.</p>}</section>}
      {isLeadResource(resource)&&<section className="detail-section lead-timeline-section"><h3>Meetings & Follow-up Tasks</h3>
        {timeline===null?<p className="muted">Checking lead activity…</p>:<>
          {timeline.followups.length===0&&timeline.interviews.length===0?<p className="muted">No meetings or tasks recorded yet. Schedule one from the action bar.</p>:<>
            {timeline.followups.slice(0,12).map(task=><div className="lead-timeline-item" key={String(task.id)}><span className={`lead-timeline-dot ${task.status==='pending'?'pending':''}`}/><div><b>{String(task.title||'Follow-up')} <span className="lead-timeline-status">{friendly(task.status)}</span></b><small>{formatDate(task.due_at,true)} · {String(task.owner_name||'Unassigned')} · {friendly(task.channel||'task')}</small></div></div>)}
            {timeline.interviews.slice(0,8).map(meeting=><div className="lead-timeline-item" key={String(meeting.id)}><span className="lead-timeline-dot pending"/><div><b>{String(meeting.round_label||'Interview')} · {friendly(meeting.outcome)}</b><small>{formatDate(meeting.scheduled_at,true)} · {friendly(meeting.mode)} · {String(meeting.owner_name||'Recruitment')}</small>{/^https?:\/\//i.test(String(meeting.meeting_link||''))&&<a href={String(meeting.meeting_link)} target="_blank" rel="noopener noreferrer">Open meeting link</a>}</div></div>)}
          </>}
        </>}
      </section>}
      {isLeadResource(resource)&&timeline&&<section className="detail-section lead-timeline-section"><h3>Stage & Assignment History</h3>
        {timeline.stages.length===0&&timeline.assignments.length===0?<p className="muted">No status changes or reassignments recorded yet.</p>:<>
          {timeline.stages.slice(0,10).map(change=><div className="lead-timeline-item" key={String(change.id)}><span className="lead-timeline-dot"/><div><b>{friendly(change.old_stage)} → {friendly(change.new_stage)}</b><small>{String(change.changed_by_name||'Recruiter')} · {formatDate(change.created_at,true)}</small></div></div>)}
          {timeline.assignments.slice(0,10).map(change=><div className="lead-timeline-item" key={String(change.id)}><span className="lead-timeline-dot"/><div><b>Assigned to {String(change.to_name||'Recruiter')}</b><small>{String(change.from_name||'Unassigned')} · {formatDate(change.created_at,true)} · {String(change.reason||'Reassignment')}</small></div></div>)}
        </>}
      </section>}
    </div><div className="modal-footer"><button className="btn ghost" onClick={onClose}>Close</button>{resource==='followups'&&row.status==='pending'&&<button className="btn soft" onClick={onComplete}><CheckCircle size={16}/> Complete</button>}{isLeadResource(resource)&&<button className="btn soft" onClick={onMeeting}>Schedule Meeting</button>}{['company-leads','candidates','applications'].includes(resource)&&<button className="btn soft" onClick={onLog}>Log Contact</button>}{resource==='company-leads'&&row.stage!=='converted'&&<button className="btn soft" onClick={onConvert}>Convert to Client</button>}{onDelete&&user.role==='admin'&&<button className="btn ghost" onClick={onDelete}><Trash2 size={16}/> Delete Lead</button>}<button className="btn primary" onClick={onEdit}><Edit3 size={16}/> Edit</button></div>
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
  const canLeadAllocation=canBulkAssign&&isLeadResource(resource);
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
    {resource==='applications'&&<div className="crm-prerequisite-note"><span><strong>Application flow:</strong> Choose a candidate and a job requirement, then track the application and schedule an interview.</span><Link href="/jobs?new=1">+ Add Job Requirement</Link></div>}
    <div className="toolbar panel"><div className="toolbar-search"><Search size={17}/><input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder={`Search ${def.plural.toLowerCase()}…`}/></div>
      {(()=>{const stages=cfg.stagesFor(resource,def.stages);return stages&&<select value={stage} onChange={e=>{setStage(e.target.value);setPage(1);}}><option value="">All Stages</option>{stages.map(v=><option key={v} value={v}>{cfg.label(resource,'stage',v)}</option>)}</select>;})()}
      <span className="record-count">{rows.length} records on this page</span></div>
    {canLeadAllocation&&<LeadAssignmentPanel resource={resource} search={search} stage={stage} selectedIds={checked} employees={employees} onAssigned={()=>void load()} onClear={()=>setChecked([])}/>}
    {canBulkAssign&&checked.length>0&&<div className="toolbar panel"><strong>{checked.length} selected</strong>{!canLeadAllocation&&<><select className="form-input" aria-label="Assign selected records to" value={bulkOwner} onChange={e=>setBulkOwner(e.target.value)}><option value="">Select receiving employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select><button className="btn primary" disabled={!bulkOwner||bulkBusy} onClick={bulkAssign}>{bulkBusy?'Assigning…':'Assign Selected'}</button></>}{canDelete&&<button className="btn ghost" disabled={bulkBusy} onClick={()=>void deleteLeads(checked)}><Trash2 size={16}/> Delete Selected</button>}<button className="btn ghost" onClick={()=>setChecked([])}>Clear</button></div>}
    {error&&<div className="alert danger">{error}</div>}
    <div className="table-panel panel"><div className="panel-header"><h2>All Records</h2><span className="muted">Select a row to view details</span></div><div className="table-scroll" tabIndex={0} aria-label={`${def.plural} records, scroll horizontally to see more columns`}><table className={resource==='candidates'?'candidate-table':undefined}><thead><tr>{canBulkAssign&&<th><input type="checkbox" aria-label="Select all on this page" checked={rows.length>0&&checked.length===rows.length} onChange={e=>setChecked(e.target.checked?rows.map(row=>String(row.id)):[])}/></th>}{def.columns.map(col=><th key={col}>{friendly(col)}</th>)}<th>Action</th></tr></thead><tbody>{loading?<tr><td colSpan={def.columns.length+1+Number(canBulkAssign)} className="table-empty">Loading records…</td></tr>:rows.length===0?<tr><td colSpan={def.columns.length+1+Number(canBulkAssign)} className="table-empty">No records yet. Create your first {def.singular.toLowerCase()}.</td></tr>:rows.map(row=><tr key={String(row.id)}>{canBulkAssign&&<td><input type="checkbox" aria-label={`Select ${createLabel(resource,row)}`} checked={checked.includes(String(row.id))} onChange={e=>setChecked(old=>e.target.checked?[...old,String(row.id)]:old.filter(id=>id!==row.id))}/></td>}{def.columns.map((col,index)=><td key={col}>{index===0?<button className="record-link" onClick={()=>setSelected(row)}>{displayRow(row,col,labelOf)}</button>:displayRow(row,col,labelOf)}</td>)}<td><span className="table-row-actions"><button className="table-action" onClick={()=>resource==='followups'&&row.status==='pending'?setCompletion(row):setSelected(row)}>{resource==='followups'&&row.status==='pending'?'Log':'View'} <ArrowRight size={13}/></button>{canDelete&&<button className="table-action" onClick={()=>void deleteLeads([String(row.id)])}><Trash2 size={13}/> Delete</button>}</span></td></tr>)}</tbody></table></div>
      <div className="table-footer"><span>Page {page}</span><div><button disabled={page<=1||loading} onClick={()=>setPage(x=>x-1)}><ArrowLeft size={15}/> Prev</button><button disabled={!hasMore||loading} onClick={()=>setPage(x=>x+1)}>Next <ArrowRight size={15}/></button></div></div>
    </div>
    {edit!==false&&<RecordForm resource={resource} current={edit} onClose={()=>setEdit(false)} onSaved={save}/>}
    {intake&&<CandidateIntake initialTab={intake} onClose={()=>setIntake(false)} onSaved={intakeSaved}/>}
    {selected&&<RecordDetail resource={resource} row={selected} onClose={()=>setSelected(null)} onEdit={()=>{setEdit(selected);setSelected(null);}} onComplete={()=>{setCompletion(selected);setSelected(null);}} onLog={()=>{setActivity(selected);setSelected(null);}} onMeeting={()=>{setActivity({...selected,__presetMeeting:true});setSelected(null);}} onConvert={()=>{void convertLead();}} onDelete={canDelete?()=>void deleteLeads([String(selected.id)]):undefined} onUpdated={record=>{setSelected(record);void load();}}/>}
    {completion&&<FollowupCompletion row={completion} onClose={()=>setCompletion(null)} onDone={complete}/>}
    {activity&&<ActivityForm resource={resource} row={activity} initialChannel={activity.__presetMeeting?'meeting':'call'} onClose={()=>setActivity(null)} onDone={()=>{setActivity(null);void load();}}/>}
  </div>;
}
