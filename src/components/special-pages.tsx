'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Bell, CheckCircle2, Download, FileSpreadsheet, ShieldCheck, UploadCloud } from 'lucide-react';
import { formatDate, friendly, requestJson } from '@/lib/client-api';
import { PERMISSION_LABELS, ROLES, ROLE_LABELS, can, type Role } from '@/lib/hr/core';
import { useCurrentUser } from './workspace-shell';

type Row=Record<string,unknown>;
type DailyStats={activities:number;calls:number;followups:number;interviews:number};
const EMPTY_STATS:DailyStats={activities:0,calls:0,followups:0,interviews:0};

function Heading({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div></div>;
}

export function DailyReportPage(){
  const [date,setDate]=useState(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}));
  const [stats,setStats]=useState<DailyStats>(EMPTY_STATS);
  const [blockers,setBlockers]=useState('');const [tomorrow,setTomorrow]=useState('');
  const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);
  useEffect(()=>{let cancelled=false;setLoading(true);setError('');requestJson<{data?:{stats?:Partial<DailyStats>;report?:Row|null}}>(`/api/v1/daily-report?date=${date}`)
    .then(x=>{if(cancelled)return;const data=x.data;if(!data)throw new Error('Daily report data is unavailable.');const incoming=data.stats||{};setStats({activities:Number(incoming.activities)||0,calls:Number(incoming.calls)||0,followups:Number(incoming.followups)||0,interviews:Number(incoming.interviews)||0});setBlockers(String(data.report?.blockers||''));setTomorrow(String(data.report?.tomorrow_plan||''));})
    .catch(e=>{if(!cancelled){setStats(EMPTY_STATS);setBlockers('');setTomorrow('');setError(e instanceof Error?e.message:'Unable to load daily report.');}}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[date]);
  async function save(event:FormEvent){event.preventDefault();setBusy(true);setError('');setMessage('');try{
    const response=await requestJson<{data?:{stats?:Partial<DailyStats>}}>('/api/v1/daily-report',{method:'POST',body:JSON.stringify({date,blockers,tomorrow_plan:tomorrow})});const incoming=response.data?.stats||{};setStats({activities:Number(incoming.activities)||0,calls:Number(incoming.calls)||0,followups:Number(incoming.followups)||0,interviews:Number(incoming.interviews)||0});setMessage('Daily report submitted successfully.');
  }catch(err){setError(err instanceof Error?err.message:'Unable to submit');}finally{setBusy(false);}}
  return <div className="page-shell"><Heading eyebrow="RECRUITER / DAILY ACTIVITY" title="My Daily Report" description="Verified numbers are calculated automatically from recorded activities, not manually typed."/>
    <div className="toolbar panel"><label className="form-field"><span>Report Date</span><input className="form-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
    {loading?<div className="panel empty-small">Loading verified activity statistics…</div>:<div className="metric-grid">{(['activities','calls','followups','interviews'] as Array<keyof DailyStats>).map(key=>{const titles:Record<keyof DailyStats,string>={activities:'Total Logged Actions',calls:'Calls Logged',followups:'Follow-ups Completed',interviews:'Interviews Scheduled'};return <div className="metric-card" key={key}><div className="metric-label">{titles[key]}</div><div className="metric-number">{stats[key]}</div><p>Based on system records</p></div>;})}</div>}
    <div className="panel form-panel"><div className="panel-header"><h2>End of Day Summary</h2></div><form className="stacked-fields" onSubmit={save}><label className="form-field"><span>Blockers / Problems</span><textarea className="form-input" rows={4} value={blockers} onChange={e=>setBlockers(e.target.value)}/></label><label className="form-field"><span>Tomorrow's Plan</span><textarea className="form-input" rows={4} value={tomorrow} onChange={e=>setTomorrow(e.target.value)}/></label>{error&&<div className="alert danger">{error}</div>}{message&&<div className="alert success">{message}</div>}<button className="btn primary" disabled={busy}>{busy?'Submitting…':'Submit Daily Report'}</button></form></div>
  </div>;
}

type ReportData={company:Array<{stage:string;total:number}>;candidates:Array<{stage:string;total:number}>;
  applications:Array<{stage:string;total:number}>;employees:Array<{id:string;full_name:string;logged_actions:number;completed_followups:number}>;overdue:number};
function Funnel({title,rows}:{title:string;rows:Array<{stage:string;total:number}>}) {
  const maximum=Math.max(1,...rows.map(row=>row.total));
  return <div className="panel funnel-panel"><div className="panel-header"><h2>{title}</h2></div>{rows.length?rows.map(row=><div key={row.stage} className="funnel-row"><div><b>{friendly(row.stage)}</b><strong>{row.total}</strong></div><div className="progress-track"><span style={{width:`${row.total/maximum*100}%`}}/></div></div>):<div className="empty-small">No records in this date range.</div>}</div>;
}
export function ReportsPage(){
  const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [report,setReport]=useState<ReportData|null>(null);const [error,setError]=useState('');
  useEffect(()=>{const q=new URLSearchParams();if(from)q.set('from',from);if(to)q.set('to',to);
    requestJson<{data:ReportData}>(`/api/v1/reports?${q}`).then(r=>setReport(r.data)).catch(e=>setError(e.message));},[from,to]);
  return <div className="page-shell"><Heading eyebrow="MANAGEMENT / ANALYTICS" title="Reports & Analytics" description="Company conversion, candidate hiring stages and verified employee activity."/>
    <div className="toolbar panel"><label className="form-field"><span>From</span><input type="date" className="form-input" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="form-field"><span>To</span><input type="date" className="form-input" value={to} onChange={e=>setTo(e.target.value)}/></label><span className="record-count">Overdue tasks: {report?.overdue??'—'}</span></div>
    {error&&<div className="alert danger">{error}</div>}
    <div className="dashboard-grid report-grid"><Funnel title="Company Lead Funnel" rows={report?.company||[]}/><Funnel title="Candidate Pipeline" rows={report?.candidates||[]}/></div>
    <div className="dashboard-grid report-grid"><Funnel title="Applications / Hiring Funnel" rows={report?.applications||[]}/><div className="panel"><div className="panel-header"><h2>Recruiter Productivity</h2></div>{report?.employees?.map(row=><div className="productivity-row" key={row.id}><b>{row.full_name}</b><span>{row.logged_actions} actions</span><strong>{row.completed_followups} follow-ups</strong></div>)}</div></div>
  </div>;
}

export function NotificationsPage(){
  const [notifications,setNotifications]=useState<Row[]>([]);
  const [error,setError]=useState('');
  async function load(){try{setNotifications((await requestJson<{data:Row[]}>('/api/v1/notifications')).data);}catch(e){setError(e instanceof Error?e.message:'Unable to load');}}
  useEffect(()=>{void load();},[]);
  async function markRead(id:string){await requestJson('/api/v1/notifications',{method:'PATCH',body:JSON.stringify({id})});await load();}
  return <div className="page-shell"><Heading eyebrow="WORKSPACE / UPDATES" title="Notification Center" description="Assignment alerts, follow-up reminders and workflow notices."/>
    {error&&<div className="alert danger">{error}</div>}
    <div className="panel notification-panel">{notifications.length?notifications.map(item=><div className={`notification-row ${!item.read_at?'unread':''}`} key={String(item.id)}><span className="notification-icon"><Bell size={18}/></span><div><b>{String(item.title)}</b><p>{String(item.body||'')}</p><small>{formatDate(item.created_at,true)}</small></div>{!item.read_at&&<button className="btn soft small" onClick={()=>markRead(String(item.id))}>Mark read</button>}</div>):<div className="empty-small">No notifications yet.</div>}</div>
  </div>;
}

export function AuditPage(){
  const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Row[]}>('/api/v1/audit').then(r=>setRows(r.data)).catch(e=>setError(e.message));},[]);
  return <div className="page-shell"><Heading eyebrow="SECURITY / COMPLIANCE" title="Audit Log" description="Who created, edited, reassigned or reviewed each record, and when."/>
    {error&&<div className="alert danger">{error}</div>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Date / Time','Employee','Action','Record Type','Details'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(item=><tr key={String(item.id)}><td>{formatDate(item.created_at,true)}</td><td>{String(item.actor_name||'System')}</td><td><b>{friendly(item.action)}</b></td><td>{friendly(item.entity_type)}</td><td className="audit-details">{JSON.stringify(item.details||{})}</td></tr>)}{!rows.length&&<tr><td colSpan={5} className="table-empty">No events recorded yet.</td></tr>}</tbody></table></div></div>
  </div>;
}

export function ActivityHistoryPage(){
  const [rows,setRows]=useState<Row[]>([]);const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Row[]}>('/api/v1/activities').then(result=>setRows(result.data))
    .catch(err=>setError(err instanceof Error?err.message:'Cannot load activity history'));},[]);
  return <div className="page-shell"><Heading eyebrow="RECRUITMENT / COMMUNICATION RECORDS" title="Activity History" description="Calls, messages, meetings and contact outcomes recorded by the recruiting team."/>
    {error&&<div className="alert danger">{error}</div>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr>{['Date / Time','Recruiter','Related Record','Channel','Outcome','Notes'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(item=><tr key={String(item.id)}><td>{formatDate(item.created_at,true)}</td><td>{String(item.employee_name)}</td><td>{friendly(item.target_type)} <small>{String(item.target_id).slice(0,8)}</small></td><td>{friendly(item.channel)}</td><td><b>{friendly(item.outcome)}</b></td><td>{String(item.notes||'—')}</td></tr>)}{rows.length===0&&<tr><td className="table-empty" colSpan={6}>No logged activity yet. Recruiters can log their follow-ups from the related lead or task.</td></tr>}</tbody></table></div></div>
  </div>;
}

type Review=Row & {id:string;upload_name:string;matched_candidate_name?:string;status:string;reason:string;parsed_data?:Row};
export function DuplicateReviewsPage(){
  const [rows,setRows]=useState<Review[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState('');
  const [reason,setReason]=useState('');
  async function load(){try{setRows((await requestJson<{data:Review[]}>('/api/v1/duplicates')).data);}catch(e){setError(e instanceof Error?e.message:'Cannot load duplicate queue');}}
  useEffect(()=>{void load();},[]);
  async function decide(id:string,action:string){
    if(action==='create_separate'&&reason.trim().length<8){setError('Provide a justification of at least 8 characters');return;}
    if(!window.confirm(`Confirm duplicate decision: ${friendly(action)}?`))return;
    setBusy(id);setError('');try{await requestJson('/api/v1/duplicates',{method:'PATCH',body:JSON.stringify({id,action,reason})});await load();setReason('');}
    catch(err){setError(err instanceof Error?err.message:'Action failed');}finally{setBusy('');}}
  return <div className="page-shell"><Heading eyebrow="DATA QUALITY / ADMIN REVIEW" title="Duplicate Resume Review" description="Review matching identities without silently merging candidate records."/>
    {error&&<div className="alert danger">{error}</div>}
    {rows.filter(row=>row.status==='pending').length===0?<div className="panel empty-state"><ShieldCheck size={32}/><h2>No duplicates waiting for review</h2><p>Possible identity matches will appear here after resume upload.</p></div>:rows.filter(row=>row.status==='pending').map(row=><div className="panel duplicate-card" key={row.id}><div className="duplicate-heading"><AlertCircle size={22}/><div><h2>Potential Duplicate Identified</h2><p>{row.reason} · {row.upload_name}</p></div></div><div className="duplicate-comparison"><div><h3>New Resume Upload</h3>{Object.entries(row.parsed_data||{}).filter(([key])=>['full_name','email','phone','location','skills'].includes(key)).map(([key,value])=><p key={key}><span>{friendly(key)}:</span> <b>{friendly(value)}</b></p>)}</div><div><h3>Existing Candidate</h3><p><span>Name:</span> <b>{row.matched_candidate_name||'Unknown'}</b></p><p><span>Record ID:</span> <b>{String(row.matched_candidate_id)}</b></p></div></div><label className="form-field"><span>Reason to create a separate candidate (if needed)</span><input className="form-input" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Different person despite same contact…"/></label><div className="result-actions"><button className="btn primary" disabled={busy===row.id} onClick={()=>decide(row.id,'attach_existing')}>Attach as Resume Version</button><button className="btn soft" disabled={busy===row.id} onClick={()=>decide(row.id,'create_separate')}>Keep Separate</button><button className="btn ghost" disabled={busy===row.id} onClick={()=>decide(row.id,'discard')}>Discard Upload</button></div></div>)}
  </div>;
}

export function ImportsPage(){
  const [file,setFile]=useState<File|null>(null);const [kind,setKind]=useState('company-leads');
  const [preview,setPreview]=useState<{preview:Row[];count:number;errors:Row[];mapped_fields:string[]}|null>(null);
  const [result,setResult]=useState<Row|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  async function send(dryRun:boolean){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);form.set('kind',kind);form.set('dry_run',String(dryRun));const data=await requestJson<Record<string,unknown>>('/api/v1/imports',{method:'POST',body:form});if(dryRun)setPreview(data as unknown as typeof preview);else{setResult(data.data as Row);setPreview(null);}}
    catch(err){setError(err instanceof Error?err.message:'Import failed');}finally{setBusy(false);}}
  return <div className="page-shell"><Heading eyebrow="DATA MANAGEMENT / IMPORT" title="Bulk CSV / Excel Import" description="Map spreadsheet columns, preview validation and import company/candidate leads safely."/>
    <div className="panel form-panel"><div className="panel-header"><h2>Upload Lead Spreadsheet</h2></div><div className="stacked-fields"><label className="form-field"><span>Import Type</span><select className="form-input" value={kind} onChange={e=>{setKind(e.target.value);setPreview(null);}}><option value="company-leads">Company Leads</option><option value="candidates">Candidate Leads</option></select></label><label className="form-field"><span>CSV / Excel File</span><input className="form-input" type="file" accept=".csv,.xlsx" onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);}}/></label><p className="muted">Use columns such as {kind==='company-leads'?'company_name, contact_name, email, phone, city, industry':'full_name, email, phone, location, skills, experience_years'}. Maximum 500 rows.</p><button className="btn primary" disabled={!file||busy} onClick={()=>send(true)}><FileSpreadsheet size={17}/> {busy?'Checking…':'Preview & Validate'}</button></div></div>
    {error&&<div className="alert danger">{error}</div>}
    {preview&&<div className="panel form-panel"><div className="panel-header"><h2>Preview: {preview.count} rows</h2><span>{preview.errors.length} validation issues</span></div><div className="table-scroll"><table><thead><tr>{(preview.mapped_fields||[]).slice(0,7).map(field=><th key={field}>{friendly(field)}</th>)}</tr></thead><tbody>{preview.preview.map((row,i)=><tr key={i}>{(preview.mapped_fields||[]).slice(0,7).map(key=><td key={key}>{String(row[key]||'')}</td>)}</tr>)}</tbody></table></div><div className="result-actions"><button className="btn primary" onClick={()=>send(false)} disabled={busy}>Confirm Import <ArrowRight size={16}/></button></div></div>}
    {result&&<div className="alert success"><CheckCircle2 size={18}/> Import complete: {String(result.inserted)} created, {String(result.skipped)} skipped.</div>}
  </div>;
}

export function PermissionsPage(){
  const crm=[['View All Leads & Candidates','All organization records','Assigned records only'],['Assign / Transfer Leads','Full access','Not allowed'],['View Candidate Resumes','Authorized scope','Assigned candidate only'],['Log Calls / Follow-ups','All records','Own assigned records'],['Handover Employee Work','Full access','Not allowed'],['Review Duplicate Candidates','Full access','Request Admin review'],['CRM Reports, Audit & Customization','All teams and history','Own daily report'],['Bulk CSV / Excel Import','Allowed','Not allowed']];
  const groups=[...new Set(PERMISSION_LABELS.map(p=>p[0]))];
  const mark=(role:Role,id:string)=>can(role,id)?<span className="status-badge tone-good">Allowed</span>:<span className="status-badge tone-muted">No</span>;
  return <div className="page-shell"><Heading eyebrow="SECURITY / ACCESS CONTROL" title="Roles & Permissions" description="Server-enforced access rules for administrators, HR managers, finance users and employees."/>
    <div className="panel table-panel"><div className="panel-header"><h2>Recruitment CRM</h2></div><div className="table-scroll"><table><thead><tr><th>Permission</th><th>Administrator</th><th>HR Manager, Finance & Employee</th></tr></thead><tbody>{crm.map(([action,admin,other])=><tr key={action}><td><b>{action}</b></td><td>{admin}</td><td>{other}</td></tr>)}</tbody></table></div></div>
    <div className="panel table-panel"><div className="panel-header"><div><h2>HR, Payroll & Billing</h2><p>Generated from the same permission matrix the APIs use.</p></div></div><div className="table-scroll"><table><thead><tr><th>Permission</th>{ROLES.map(r=><th key={r}>{ROLE_LABELS[r]}</th>)}</tr></thead><tbody>{groups.map(g=><>
      <tr key={g}><td colSpan={ROLES.length+1}><b>{g}</b></td></tr>{PERMISSION_LABELS.filter(p=>p[0]===g).map(([,id,label])=><tr key={id}><td>{label}<br/><small className="muted">{id}</small></td>{ROLES.map(r=><td key={r}>{mark(r,id)}</td>)}</tr>)}</>)}</tbody></table></div></div>
    <div className="inline-hint"><ShieldCheck size={18}/> Every API scopes data by organization and permission; changing a URL never grants additional access. Salary data is served only by payroll APIs, never by CRM APIs. Only Administrators can create logins or assign roles.</div></div>;
}
