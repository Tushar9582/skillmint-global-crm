'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleAlert, BriefcaseBusiness, Users, Layers3, CheckCircle2, Plus, ChevronRight, Fingerprint, Wallet, ReceiptText } from 'lucide-react';
import { requestJson, formatDate } from '@/lib/client-api';
import { Badge, fmtTime, money, useApi, useCan } from './hr/ui';
import { useCurrentUser } from './workspace-shell';

type Dashboard={company_leads:number;candidates:number;jobs:number;applications:number;
  interviews_today:number;followups_due:number;overdue:number;placements:number;
  queue:Array<{id:string;title:string;due_at:string;priority:string;owner_name:string}>;
  latest:Array<Record<string,string>>;exceptions?:{duplicate_reviews:number;unassigned_leads:number}|null};
type Hr={date:string;total_employees:number|null;present_today:number|null;absent_today:number|null;on_leave:number|null;missing_punch:number|null;pending_leave:number|null;active_shifts:number|null;pending_overtime:number|null};
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function Metric({title,value,note,icon:Icon,href}:{title:string;value:ReactNode;note:string;icon:typeof Users;href?:string}) {
  const body=<><div className="metric-label"><span>{title}</span><span className="metric-icon"><Icon size={18}/></span></div><div className="metric-number">{value}</div><p>{note}</p></>;
  return href?<Link href={href} className="metric-card" style={{display:'block'}}>{body}</Link>:<div className="metric-card">{body}</div>;
}
const Mini=({icon:Icon,label,value,href,warn}:{icon:typeof Users;label:string;value:ReactNode;href:string;warn?:boolean})=><Link href={href} className={`mini-metric ${warn?'warn':''}`}><Icon size={19}/><span>{label}</span><strong>{value}</strong></Link>;

function HrSection() {
  const can=useCan();
  const allowed=['employees.view','attendance.view_all','leave.manage','overtime.manage','shifts.manage'].some(p=>can(p));
  const hr=useApi<{data:Hr}>(allowed?'/api/v1/hr/dashboard':null);const d=hr.data?.data;
  const val=(x:number|null|undefined)=>x===null?null:(d?x:'—');
  if(!allowed)return null;
  return <><div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Human Resources</h2><p>{d?`Live attendance for ${formatDate(d.date)}`:'Loading…'}</p></div></div>
    <div className="metric-grid">
      {d?.total_employees!==null&&<Metric title="Total Employees" value={val(d?.total_employees)} note="Active staff" icon={Users} href="/hr-employees"/>}
      {d?.present_today!==null&&d?.present_today!==undefined&&<Metric title="Present Today" value={val(d.present_today)} note="Punched in or on duty" icon={CheckCircle2} href="/attendance-register"/>}
      {d?.absent_today!==null&&d?.absent_today!==undefined&&<Metric title="Absent Today" value={val(d.absent_today)} note="Working day, no attendance yet" icon={CircleAlert} href="/attendance-register"/>}
      {d?.on_leave!==null&&d?.on_leave!==undefined&&<Metric title="On Leave" value={val(d.on_leave)} note="Approved leave today" icon={CalendarClock} href="/leave"/>}
    </div>
    <div className="metric-grid secondary-metrics">
      {d?.pending_leave!==null&&d?.pending_leave!==undefined&&<Mini icon={CalendarClock} label="Pending Leave Requests" value={d.pending_leave} href="/leave" warn={d.pending_leave>0}/>}
      {d?.pending_overtime!==null&&d?.pending_overtime!==undefined&&<Mini icon={CalendarClock} label="Pending Overtime Approvals" value={d.pending_overtime} href="/overtime" warn={d.pending_overtime>0}/>}
      {d?.active_shifts!==null&&d?.active_shifts!==undefined&&<Mini icon={Layers3} label="Active Shifts" value={d.active_shifts} href="/shifts"/>}
      {d?.missing_punch!==null&&d?.missing_punch!==undefined&&<Mini icon={CircleAlert} label="Missing Punch-outs" value={d.missing_punch} href="/attendance-register" warn={d.missing_punch>0}/>}
    </div></>;
}

function FinanceSection() {
  const can=useCan();
  const payroll=useApi<{data:{latest:{period_year:number;period_month:number;status:string;employee_count:number;total_net:number}|null;open_runs:number;without_structure:number}}>(can('payroll.view_all')?'/api/v1/payroll/dashboard':null);
  const billing=useApi<{data:{summary:{outstanding:number;overdue_amount:number;overdue_count:number;open_invoices:number}}}>(can('billing.view')?'/api/v1/finance/reports':null);
  if(!can('payroll.view_all')&&!can('billing.view'))return null;
  const p=payroll.data?.data;const b=billing.data?.data.summary;
  return <><div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Finance & Billing</h2><p>Payroll status and client receivables</p></div></div>
    <div className="metric-grid">
      {can('payroll.view_all')&&<Metric title="Payroll Summary" value={p?(p.latest?money(p.latest.total_net):'No runs'):'—'} note={p?.latest?`${MONTHS[p.latest.period_month-1]} ${p.latest.period_year} · ${p.latest.employee_count} employees · ${p.latest.status}`:'Net pay of the latest run'} icon={Wallet} href="/payroll"/>}
      {can('payroll.view_all')&&<Metric title="Payroll Runs Open" value={p?p.open_runs:'—'} note={p&&p.without_structure?`${p.without_structure} employees lack a salary structure`:'Awaiting approval or finalization'} icon={Wallet} href="/payroll"/>}
      {can('billing.view')&&<Metric title="Client Outstanding Payments" value={b?money(b.outstanding):'—'} note={b?`${b.open_invoices} open invoices`:'Unpaid balances'} icon={ReceiptText} href="/billing"/>}
      {can('billing.view')&&<Metric title="Overdue Receivables" value={b?money(b.overdue_amount):'—'} note={b?`${b.overdue_count} overdue invoices`:'Past due date'} icon={CircleAlert} href="/billing"/>}
    </div></>;
}

function MyDay() {
  const me=useApi<{data:{record:Record<string,unknown>|null;punched_in:boolean;timezone:string}}>('/api/v1/hr/attendance/me');
  const d=me.data?.data;
  return <Link href="/my-attendance" className="panel" style={{display:'flex',alignItems:'center',gap:16,padding:'16px 22px'}}><span className="metric-icon"><Fingerprint size={20}/></span>
    <div style={{flex:1}}><b>My attendance today</b><p className="muted" style={{margin:0}}>{!d?'Loading…':d.record?`In ${fmtTime(d.record.punch_in,d.timezone)}${d.record.punch_out?` · Out ${fmtTime(d.record.punch_out,d.timezone)}`:' · still on duty'}`:'You have not punched in yet'}</p></div>
    {d?.record?<Badge value={d.record.status}/>:<span className="btn primary small">Punch In <ArrowRight size={14}/></span>}</Link>;
}

export function DashboardView(){
  const user=useCurrentUser();
  const [data,setData]=useState<Dashboard|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Dashboard}>('/api/v1/dashboard').then(v=>setData(v.data)).catch(e=>setError(e.message));},[]);
  const metrics=[
    {title:user.role==='admin'?'Company Leads':'My Company Leads',value:data?.company_leads,icon:BriefcaseBusiness,note:'Employer pipeline'},
    {title:user.role==='admin'?'Candidate Leads':'My Candidates',value:data?.candidates,icon:Users,note:'Candidate talent bank'},
    {title:'Active Jobs',value:data?.jobs,icon:Layers3,note:'Open job requisitions'},
    {title:'Joined / Placements',value:data?.placements,icon:CheckCircle2,note:'Successful hires'},
  ];
  return <div className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">SKILLMINT / WORKSPACE</p><h1>{user.role==='admin'?'Good morning':'Welcome back'}, {user.full_name.split(' ')[0]}</h1><p>Recruitment, people and finance in one workspace.</p></div><Link className="btn primary" href="/company-leads?new=1"><Plus size={16}/> Add Lead</Link></div>
    {error&&<div className="alert danger">{error}</div>}
    <MyDay/>
    <HrSection/>
    <FinanceSection/>
    <div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Recruitment CRM</h2><p>Your pipeline and work priorities</p></div></div>
    <div className="metric-grid">{metrics.map(item=>{const Icon=item.icon;return <div className="metric-card" key={item.title}><div className="metric-label"><span>{item.title}</span><span className="metric-icon"><Icon size={18}/></span></div><div className="metric-number">{data?item.value:'—'}</div><p>{item.note}</p></div>;})}</div>
    <div className="metric-grid secondary-metrics">
      <div className="mini-metric"><CalendarClock size={19}/><span>Pending Follow-ups (due today)</span><strong>{data?.followups_due??'—'}</strong></div>
      <div className="mini-metric warn"><CircleAlert size={19}/><span>Overdue Follow-ups</span><strong>{data?.overdue??'—'}</strong></div>
      <div className="mini-metric"><CalendarClock size={19}/><span>Interviews Today</span><strong>{data?.interviews_today??'—'}</strong></div>
      <div className="mini-metric"><Users size={19}/><span>Applications</span><strong>{data?.applications??'—'}</strong></div>
    </div>
    <div className="dashboard-grid">
      <div className="panel"><div className="panel-header"><div><h2>My Priority Queue</h2><p>Due work sorted by deadline</p></div><Link href="/followups" className="text-link">All follow-ups <ArrowRight size={15}/></Link></div>
        <div className="queue-list">{!data?<div className="empty-small">Loading work queue…</div>:data.queue.length===0?<div className="empty-small">You are all caught up. No pending follow-ups.</div>:data.queue.map(task=><div className="queue-row" key={task.id}><span className="queue-marker"><CalendarClock size={17}/></span><div><b>{task.title}</b><small>{user.role==='admin'?task.owner_name:'Follow-up'} · {task.priority}</small></div><time>{formatDate(task.due_at,true)}</time></div>)}</div>
      </div>
      <div className="panel"><div className="panel-header"><div><h2>Quick Actions</h2><p>Common daily tasks</p></div></div>
        <div className="quick-actions">
          <Link href="/company-leads?new=1"><BriefcaseBusiness size={20}/><div><b>Create company lead</b><small>Register employer prospect</small></div><ChevronRight size={16}/></Link>
          <Link href="/candidates?mode=resume"><Users size={20}/><div><b>Upload candidate resume</b><small>Extract information and create lead</small></div><ChevronRight size={16}/></Link>
          <Link href="/followups?new=1"><CalendarClock size={20}/><div><b>Schedule a follow-up</b><small>Track your next contact</small></div><ChevronRight size={16}/></Link>
          <Link href="/leave"><CalendarClock size={20}/><div><b>Apply for leave</b><small>Check balances and request time off</small></div><ChevronRight size={16}/></Link>
          <Link href="/daily-report"><CheckCircle2 size={20}/><div><b>Submit daily report</b><small>Automatically verified progress</small></div><ChevronRight size={16}/></Link>
        </div>
      </div>
    </div>
    {user.role==='admin' && <div className="dashboard-grid lower-panels"><div className="panel"><div className="panel-header"><h2>Requires Attention</h2></div><div className="attention-row"><CircleAlert size={18}/><span>Potential duplicate resumes</span><Link href="/duplicate-reviews">{data?.exceptions?.duplicate_reviews??'—'} to review</Link></div><div className="attention-row"><CircleAlert size={18}/><span>Unassigned company leads</span><Link href="/company-leads">{data?.exceptions?.unassigned_leads??'—'} records</Link></div></div>
      <div className="panel"><div className="panel-header"><h2>Recent Activity</h2></div><div className="activity-small">{data?.latest?.length?data.latest.slice(0,5).map((x,i)=><div key={String(x.id||i)}><span>{String(x.actor_name||'Recruiter')}</span><b>{String(x.action||x.outcome||'Activity')}</b><small>{formatDate(x.created_at,true)}</small></div>):<p className="muted">No recent activity yet.</p>}</div></div></div>}
  </div>;
}
