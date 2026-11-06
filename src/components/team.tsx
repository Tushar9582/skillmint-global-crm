'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Lock, Plus, ShieldAlert, UserRoundCog, X } from 'lucide-react';
import { requestJson, friendly, formatDate } from '@/lib/client-api';
import { useCurrentUser } from './workspace-shell';

type Row=Record<string,unknown>;
type EmployeeDetail={user:Row;activity:Row[];followups:Row[];applications:Row[];daily:Row[];logins:Row[];history:Row[]};

export function EmployeesPage(){
  const current=useCurrentUser();
  const [employees,setEmployees]=useState<Row[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState<Row|null>(null);
  const [detail,setDetail]=useState<EmployeeDetail|null>(null);
  const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [resetPassword,setResetPassword]=useState('');
  const [resetMessage,setResetMessage]=useState('');
  const [form,setForm]=useState({full_name:'',email:'',team:'',temporary_password:''});
  async function load(){try{const result=await requestJson<{data:Row[]}>('/api/v1/employees');setEmployees(result.data);}catch(err){setError(err instanceof Error?err.message:'Unable to load employees');}}
  useEffect(()=>{void load();},[]);
  useEffect(()=>{if(!selected)return;const q=new URLSearchParams();if(from)q.set('from',from);if(to)q.set('to',to);
    requestJson<{data:EmployeeDetail}>(`/api/v1/employees/${selected.id}/detail?${q}`).then(v=>setDetail(v.data)).catch(err=>setError(err.message));
  },[selected,from,to]);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
    await requestJson('/api/v1/employees',{method:'POST',body:JSON.stringify(form)});
    setOpen(false);setForm({full_name:'',email:'',team:'',temporary_password:''});await load();
  }catch(err){setError(err instanceof Error?err.message:'Cannot create employee');}finally{setBusy(false);}}
  async function resetEmployeePassword(){if(!selected||resetPassword.length<12)return;
    if(!window.confirm(`Reset the password for ${String(selected.full_name)} and sign out their devices?`))return;
    setBusy(true);setError('');setResetMessage('');try{
      await requestJson(`/api/v1/employees/${selected.id}`,{method:'PATCH',body:JSON.stringify({temporary_password:resetPassword})});
      setResetPassword('');setResetMessage('Temporary password saved. All previous sessions were revoked. Share the password securely.');
    }catch(err){setError(err instanceof Error?err.message:'Unable to reset password');}finally{setBusy(false);}
  }
  if(current.role!=='admin')return <div className="alert danger">Admin access required.</div>;
  return <div className="page-shell"><div className="page-heading"><div><p className="eyebrow">MANAGEMENT / PEOPLE</p><h1>Employee Management</h1><p>Register recruiters, track work history and handle controlled access.</p></div><button className="btn primary" onClick={()=>setOpen(true)}><Plus size={16}/> Register Employee</button></div>
    {error&&<div className="alert danger">{error}</div>}
    <div className="metric-grid"><div className="metric-card"><div className="metric-label">Active Employees</div><div className="metric-number">{employees.filter(x=>x.active&&x.role==='employee').length}</div><p>Recruiter access enabled</p></div><div className="metric-card"><div className="metric-label">Disabled Accounts</div><div className="metric-number">{employees.filter(x=>!x.active).length}</div><p>Access revoked</p></div><div className="metric-card"><div className="metric-label">Assigned Company Leads</div><div className="metric-number">{employees.reduce((n,x)=>n+Number(x.company_leads||0),0)}</div><p>Across all employees</p></div><div className="metric-card"><div className="metric-label">Pending Follow-ups</div><div className="metric-number">{employees.reduce((n,x)=>n+Number(x.pending_followups||0),0)}</div><p>Requiring action</p></div></div>
    <div className="panel table-panel"><div className="panel-header"><h2>Staff Accounts</h2></div><div className="table-scroll"><table><thead><tr>{['Employee','Email','Team','Company Leads','Candidates','Pending Tasks','Status','Action'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{employees.map(emp=><tr key={String(emp.id)}><td><b>{String(emp.full_name)}</b></td><td>{String(emp.email)}</td><td>{String(emp.team||'—')}</td><td>{String(emp.company_leads)}</td><td>{String(emp.candidates)}</td><td>{String(emp.pending_followups)}</td><td><span className={`status-badge ${emp.active?'status-connected':'status-rejected'}`}>{emp.active?'Active':'Disabled'}</span></td><td><button className="table-action" onClick={()=>{setSelected(emp);setDetail(null);}}>360 View <ArrowRight size={14}/></button></td></tr>)}</tbody></table></div></div>
    {open&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">ADMIN ONLY</p><h2>Register Employee</h2><p>New employee will be asked to change the temporary password.</p></div><button className="icon-only" onClick={()=>setOpen(false)}><X/></button></div><form onSubmit={submit}><div className="modal-content form-grid">{[
      ['full_name','Full Name'],['email','Work Email'],['team','Team / Department'],['temporary_password','Temporary Password (12+ characters)'],
    ].map(([key,label])=><label className="form-field" key={key}><span>{label}</span><input className="form-input" required={key!=='team'} type={key.includes('password')?'password':key==='email'?'email':'text'} value={form[key as keyof typeof form]} onChange={e=>setForm(p=>({...p,[key]:e.target.value}))}/></label>)}</div><div className="modal-footer"><button className="btn ghost" type="button" onClick={()=>setOpen(false)}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>{busy?'Registering…':'Create Employee'}</button></div></form></div></div>}
    {selected&&<div className="modal-backdrop"><div className="detail-drawer" role="dialog" aria-modal="true"><div className="modal-header"><div><p className="eyebrow">EMPLOYEE / 360° HISTORY</p><h2>{String(selected.full_name)}</h2><p>{String(selected.email)}</p></div><button className="icon-only" onClick={()=>setSelected(null)}><X/></button></div><div className="detail-content"><div className="form-grid"><label className="form-field"><span>From Date</span><input type="date" className="form-input" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="form-field"><span>To Date</span><input type="date" className="form-input" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
      {!detail?<p>Loading employee history…</p>:<><div className="detail-field-grid"><div><small>Logged Actions</small><strong>{detail.activity.length}</strong></div><div><small>Follow-up Records</small><strong>{detail.followups.length}</strong></div><div><small>Daily Reports</small><strong>{detail.daily.length}</strong></div><div><small>Login Events</small><strong>{detail.logins.length}</strong></div></div>
      <div className="detail-section"><h3>Recruitment Status</h3>{detail.applications.map((r,i)=><div className="activity-entry" key={i}><b>{friendly(r.stage)}</b> · {String(r.total)}</div>)}</div>
      <div className="detail-section"><h3>Recent Activity & Work History</h3>{detail.activity.slice(0,35).map((r,i)=><div className="activity-entry" key={i}><b>{friendly(r.channel)} · {friendly(r.outcome)}</b><small>{formatDate(r.created_at,true)}</small><p>{String(r.notes||'')}</p></div>)}</div>
      <div className="detail-section"><h3>Submitted Daily Reports</h3>{detail.daily.slice(0,14).map((r,i)=><div className="activity-entry" key={i}><b>{formatDate(r.report_date)}</b><p>Blockers: {String(r.blockers||'None')} | Tomorrow: {String(r.tomorrow_plan||'—')}</p></div>)}</div></>}
      {Boolean(selected.active) && selected.role==='employee'&&<div className="detail-section"><h3>Admin Password Reset</h3><p className="muted">Give the employee a unique temporary password; they must change it at their next login.</p><label className="form-field"><span>New Temporary Password (12+ characters)</span><input className="form-input" type="password" minLength={12} value={resetPassword} onChange={e=>setResetPassword(e.target.value)} placeholder="Create a strong temporary password"/></label><button className="btn secondary" type="button" disabled={busy||resetPassword.length<12} onClick={resetEmployeePassword}>Reset Password & Sign Out Devices</button>{resetMessage&&<div className="alert success">{resetMessage}</div>}</div>}
      </div><div className="modal-footer"><button className="btn primary" onClick={()=>{setSelected(null);setResetPassword('');setResetMessage('');}}>Close</button></div></div></div>}
  </div>;
}

export function HandoverPage(){
  const current=useCurrentUser();
  const [employees,setEmployees]=useState<Row[]>([]);
  const [from,setFrom]=useState('');const [to,setTo]=useState('');
  const [reason,setReason]=useState('Employee left SkillMint Global');
  const [preview,setPreview]=useState<{counts:Record<string,number>;total:number}|null>(null);
  const [result,setResult]=useState<Record<string,unknown>|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Row[]}>('/api/v1/employees').then(r=>setEmployees(r.data.filter(e=>e.active&&e.role==='employee'))).catch(()=>{});},[]);
  useEffect(()=>{setPreview(null);setResult(null);if(from)requestJson<{counts:Record<string,number>;total:number}>(`/api/v1/handover?employee_id=${from}`).then(setPreview).catch(e=>setError(e.message));},[from]);
  async function handover(){if(!from||!to||from===to){setError('Choose two different employees');return;}
    if(!window.confirm('Transfer ALL current assignments and disable the departing employee? This is a high-impact action.'))return;
    setBusy(true);setError('');try{const r=await requestJson<{data:Record<string,unknown>}>('/api/v1/handover',{method:'POST',body:JSON.stringify({from_user:from,to_user:to,reason})});setResult(r.data);setPreview(null);}
    catch(err){setError(err instanceof Error?err.message:'Handover failed');}finally{setBusy(false);}}
  if(current.role!=='admin')return <div className="alert danger">Admin access required.</div>;
  return <div className="page-shell"><div className="page-heading"><div><p className="eyebrow">MANAGEMENT / BUSINESS CONTINUITY</p><h1>Employee Exit & Reassignment</h1><p>Transfer leads, candidates, jobs, applications and pending tasks while preserving original histories.</p></div></div>
    <div className="handover-layout"><div className="panel form-panel"><div className="panel-header"><h2>Handover Wizard</h2></div><div className="stacked-fields">
      <label className="form-field"><span>Departing Employee</span><select className="form-input" value={from} onChange={e=>setFrom(e.target.value)}><option value="">Select employee</option>{employees.map(e=><option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></label>
      <label className="form-field"><span>Receiving Employee</span><select className="form-input" value={to} onChange={e=>setTo(e.target.value)}><option value="">Select replacement</option>{employees.filter(e=>String(e.id)!==from).map(e=><option key={String(e.id)} value={String(e.id)}>{String(e.full_name)}</option>)}</select></label>
      <label className="form-field"><span>Reason / Audit Note</span><textarea className="form-input" value={reason} onChange={e=>setReason(e.target.value)} rows={3}/></label>
      {error&&<div className="alert danger">{error}</div>}
      <button className="btn primary full" disabled={!from||!to||busy||!preview} onClick={handover}>{busy?'Transferring…':'Transfer Work & Disable Employee'} <ArrowRight size={16}/></button>
    </div></div><div className="panel preview-panel"><div className="panel-header"><h2>Transfer Preview</h2></div>{preview?<><p className="muted">All currently owned work that will move to the new recruiter:</p><div className="handover-counts">{Object.entries(preview.counts).map(([key,value])=><div key={key}><span>{friendly(key)}</span><b>{value}</b></div>)}</div><div className="handover-total">Total Assignment Changes <strong>{preview.total}</strong></div></>:<div className="empty-small">Select a departing employee to preview their work.</div>}
      <div className="inline-hint"><ShieldAlert size={20}/> Historical activities and completed follow-ups keep their original employee attribution.</div></div></div>
    {result&&<div className="alert success"><CheckCircle2 size={18}/> Handover completed. Departing account access was disabled and sessions revoked.</div>}
  </div>;
}

export function EmployeeProfilePage(){
  const current=useCurrentUser();
  const [old,setOld]=useState('');const [next,setNext]=useState('');const [confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  async function save(event:FormEvent){event.preventDefault();setError('');setMessage('');if(next!==confirm){setError('Passwords do not match');return;}
    setBusy(true);try{await requestJson('/api/auth/me',{method:'PATCH',body:JSON.stringify({current_password:old,new_password:next})});
      setMessage('Password updated successfully.');setOld('');setNext('');setConfirm('');window.location.reload();
    }catch(err){setError(err instanceof Error?err.message:'Unable to update password');}finally{setBusy(false);}}
  return <div className="page-shell"><div className="page-heading"><div><p className="eyebrow">MY ACCOUNT / SECURITY</p><h1>Profile & Security</h1><p>Your work identity and private login credentials.</p></div></div><div className="two-column-upload"><div className="panel form-panel"><div className="panel-header"><h2>My Profile</h2></div><div className="profile-identity"><div className="large-avatar">{current.full_name.charAt(0).toUpperCase()}</div><div><h3>{current.full_name}</h3><p>{current.email}</p><span className="status-badge status-connected">{friendly(current.role)}</span></div></div></div>
    <div className="panel form-panel"><div className="panel-header"><h2>Change Password</h2></div><form className="stacked-fields" onSubmit={save}><label className="form-field"><span>Current Password</span><input className="form-input" type="password" value={old} required onChange={e=>setOld(e.target.value)}/></label><label className="form-field"><span>New Password (12+ characters)</span><input className="form-input" type="password" minLength={12} required value={next} onChange={e=>setNext(e.target.value)}/></label><label className="form-field"><span>Confirm New Password</span><input className="form-input" type="password" minLength={12} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>{error&&<div className="alert danger">{error}</div>}{message&&<div className="alert success">{message}</div>}<button className="btn primary" disabled={busy}><Lock size={16}/> Update Password</button></form></div></div></div>;
}
