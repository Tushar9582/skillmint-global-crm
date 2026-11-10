'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock3, PhoneCall, UsersRound, Video } from 'lucide-react';
import { formatDate, requestJson } from '@/lib/client-api';
import type { RecruiterProgress } from '@/lib/lead-operations';

type Report={period:{from:string;to:string};summary:{assigned:number;activities:number;meetings:number;followups:number};employees:RecruiterProgress[]};
const day=(offset=0)=>new Date(Date.now()+330*60000+offset*86400000).toISOString().slice(0,10);

export function RecruiterProgressPanel(){
  const [from,setFrom]=useState(day());
  const [to,setTo]=useState(day());
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    if(from>to){setError('Start date must be on or before end date.');setLoading(false);return;}
    let active=true;setLoading(true);setError('');
    requestJson<{data:Report}>(`/api/v1/lead-progress?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(response=>{if(active)setReport(response.data);})
      .catch(err=>{if(active){setReport(null);setError(err instanceof Error?err.message:'Could not load daily progress');}})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[from,to]);

  function setPreset(days:number){setFrom(day(-(days-1)));setTo(day());}

  return <section className="panel recruiter-progress" aria-label="Recruiter daily progress report">
    <div className="panel-header recruiter-progress-heading"><div><p className="eyebrow">ADMIN ACTIVITY MONITOR</p>
      <h2>Recruiter Daily Progress</h2><p>Live workloads, calls, meetings, stage movement and completed follow-ups.</p></div>
      <Link className="btn soft" href="/employees"><UsersRound size={16}/> Employee Management</Link>
    </div>
    <div className="recruiter-progress-toolbar">
      <div className="recruiter-progress-dates"><label><span>From</span><input type="date" className="form-input" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label><span>To</span><input type="date" className="form-input" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
      <div className="recruiter-periods" aria-label="Report period shortcuts"><button type="button" onClick={()=>setPreset(1)}>Today</button><button type="button" onClick={()=>setPreset(7)}>Last 7 Days</button><button type="button" onClick={()=>setPreset(30)}>Last 30 Days</button></div>
    </div>
    {error&&<div className="alert danger" role="alert">{error}</div>}
    <div className="recruiter-progress-summary">
      <div><span><UsersRound size={18}/> Currently Assigned</span><b>{loading?'…':report?.summary.assigned??'—'}</b></div>
      <div><span><PhoneCall size={18}/> Contact Activities</span><b>{loading?'…':report?.summary.activities??'—'}</b></div>
      <div><span><Video size={18}/> Meetings / Interviews</span><b>{loading?'…':report?.summary.meetings??'—'}</b></div>
      <div><span><CheckCircle2 size={18}/> Follow-ups Done</span><b>{loading?'…':report?.summary.followups??'—'}</b></div>
    </div>
    <div className="table-scroll recruiter-progress-scroll" tabIndex={0} aria-label="Recruiter performance table, scroll horizontally to see more columns">
      <table className="recruiter-progress-table"><thead><tr><th>Recruiter</th><th>Owned Leads</th><th>Contacts</th><th>Calls</th><th>Meetings</th><th>Stage Updates</th><th>Follow-ups Done</th><th>Pending</th><th>Last Activity</th></tr></thead>
      <tbody>{loading?<tr><td colSpan={9} className="table-empty">Loading team activity…</td></tr>:
        report?.employees.length?report.employees.map(person=><tr key={person.id}>
          <td><div className="recruiter-person"><b>{person.full_name}</b><small>{person.team||'Recruitment'}{!person.active?' · Inactive':''}</small></div></td>
          <td><strong>{person.company_leads+person.candidates+person.applications}</strong><small className="recruiter-detail">{person.company_leads} company · {person.candidates} candidate · {person.applications} applications</small></td>
          <td>{person.activities}</td><td>{person.calls}</td><td>{person.meetings+person.interviews_scheduled}</td><td>{person.stage_updates}</td><td>{person.followups_done}</td>
          <td><span className={`progress-pending ${person.pending_followups>0?'has-pending':''}`}><Clock3 size={14}/>{person.pending_followups}</span></td>
          <td>{person.last_activity_at?formatDate(person.last_activity_at,true):'—'}</td>
        </tr>):<tr><td colSpan={9} className="table-empty">No team members available.</td></tr>}</tbody></table>
    </div>
    <div className="recruiter-progress-note"><CalendarDays size={16}/><span>Assigned counts show current ownership. Activities, meetings, stage updates and completions are counted within the chosen date range.</span></div>
  </section>;
}
