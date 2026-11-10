'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ListChecks, UsersRound } from 'lucide-react';
import { requestJson } from '@/lib/client-api';

type Person={id:string;label:string};
type Props={resource:string;search:string;stage:string;selectedIds:string[];employees:Person[];onAssigned:()=>void;onClear:()=>void};

export function LeadAssignmentPanel({resource,search,stage,selectedIds,employees,onAssigned,onClear}:Props){
  const [mode,setMode]=useState<'range'|'selected'>('range');
  const [from,setFrom]=useState('1');
  const [to,setTo]=useState('20');
  const [recipient,setRecipient]=useState('');
  const [reason,setReason]=useState('Recruiter workload distribution');
  const [total,setTotal]=useState<number|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [result,setResult]=useState('');

  useEffect(()=>{
    let live=true;
    setTotal(null);
    const params=new URLSearchParams({resource});
    if(search.trim())params.set('q',search.trim());
    if(stage)params.set('stage',stage);
    requestJson<{data:{total:number}}>(`/api/v1/assignments/bulk?${params}`).then(response=>{
      if(live){setTotal(response.data.total);setTo(previous=>Number(previous)>response.data.total?String(Math.max(1,response.data.total)):previous);}
    }).catch(err=>{if(live)setError(err instanceof Error?err.message:'Unable to count matching leads');});
    return ()=>{live=false;};
  },[resource,search,stage]);
  useEffect(()=>{if(selectedIds.length)setMode('selected');},[selectedIds.length]);

  const start=Number(from),end=Number(to),rangeCount=end-start+1;
  const validRange=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=1&&end>=start&&
    rangeCount<=200&&end<=10000&&total!==null&&end<=total;
  const requested=mode==='range'?validRange?rangeCount:0:selectedIds.length;
  const recipientName=employees.find(person=>person.id===recipient)?.label||'';

  async function assign(){
    setError('');setResult('');
    if(!recipient||!requested){setError('Choose a recruiter and a valid selection of leads.');return;}
    const description=mode==='range'?`rows ${start}–${end} of the current filtered list`:`${selectedIds.length} checked rows`;
    if(!window.confirm(`Assign ${description} to ${recipientName}? Existing assignments will be updated.`))return;
    setBusy(true);
    try{
      const response=await requestJson<{data:{requested:number;changed:number;recipient:string}}>('/api/v1/assignments/bulk',{
        method:'POST',body:JSON.stringify({resource,to_owner:recipient,reason:reason.trim()||'Admin lead distribution',
          ...(mode==='range'?{range:{from:start,to:end,search,stage}}:{ids:selectedIds})}),
      });
      const data=response.data;
      setResult(`${data.changed} of ${data.requested} leads assigned to ${data.recipient}${data.changed===0?' (already assigned)':''}.`);
      onAssigned();
    }catch(err){setError(err instanceof Error?err.message:'Assignment failed');}
    finally{setBusy(false);}
  }

  return <section id="lead-assignment-panel" className="panel lead-allocation" aria-label="Admin lead allocation">
    <div className="lead-allocation-title">
      <span className="lead-allocation-icon"><UsersRound size={23}/></span>
      <div><p className="eyebrow">ADMIN CONTROLS</p><h2>Lead Assignment & Distribution</h2>
        <p>Assign individual leads or a numbered range to a recruiter. Existing lead history stays intact.</p></div>
      <span className="lead-allocation-total">{total===null?'Counting…':`${total} matching leads`}</span>
    </div>
    <div className="lead-allocation-modes" role="group" aria-label="Choose assignment method">
      <button className={mode==='range'?'active':''} type="button" onClick={()=>{setMode('range');setError('');}} aria-pressed={mode==='range'}><ListChecks size={17}/> By Range</button>
      <button className={mode==='selected'?'active':''} type="button" onClick={()=>{setMode('selected');setError('');}} aria-pressed={mode==='selected'}><CheckCircle2 size={17}/> Checked Rows ({selectedIds.length})</button>
    </div>
    <div className="lead-allocation-fields">
      {mode==='range'?<>
        <label className="form-field"><span>From Row</span><input className="form-input" type="number" min="1" max="10000" step="1" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label className="form-field"><span>To Row</span><input className="form-input" type="number" min="1" max="10000" step="1" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </>:<div className="lead-allocation-selected"><b>{selectedIds.length} rows checked</b><span>Use the checkboxes in the records table below to select exactly who to assign.</span>{selectedIds.length>0&&<button onClick={onClear} type="button">Clear selection</button>}</div>}
      <label className="form-field lead-allocation-recipient"><span>Assign to Recruiter *</span><select className="form-input" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Select recruiter</option>{employees.map(person=><option key={person.id} value={person.id}>{person.label}</option>)}</select></label>
      <label className="form-field lead-allocation-reason"><span>Assignment Note</span><input className="form-input" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="Why are these leads being assigned?"/></label>
    </div>
    <div className="lead-allocation-bottom">
      <p>{mode==='range'?`Rows follow the current Search and Stage filters, newest first. Example: assign 1–20 to Recruiter A, then 21–70 to Recruiter B.`:'Checked rows are assigned together. You can select up to 200 per operation.'}</p>
      <button className="btn primary" type="button" onClick={()=>void assign()} disabled={busy||!recipient||!requested}>
        {busy?'Assigning…':`Assign ${requested||'—'} Leads`} <ArrowRight size={17}/>
      </button>
    </div>
    {mode==='range'&&total!==null&&total>0&&!validRange&&<p className="lead-allocation-hint">Enter row numbers within 1–{total}, with at most 200 leads per assignment.</p>}
    {!employees.length&&<p className="lead-allocation-hint">No active recruiters found. <Link href="/employees">Add a recruiter in CRM Team Access</Link>.</p>}
    {error&&<div className="alert danger" role="alert">{error}</div>}
    {result&&<div className="alert success" role="status"><CheckCircle2 size={17}/>{result}</div>}
  </section>;
}
