'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleAlert, BriefcaseBusiness, Users, Layers3, CheckCircle2, Plus, ChevronRight, Fingerprint, Wallet, ReceiptText, IdCard, CalendarCheck, Plane, Timer, CalendarDays, Clock3, FileText, UserRoundCog, ShieldCheck, BarChart3, Sparkles, LockKeyhole, type LucideIcon } from 'lucide-react';
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

function FinanceSection({mode}:{mode:'hrms'|'crm'}) {
  const can=useCan();
  const payroll=useApi<{data:{latest:{period_year:number;period_month:number;status:string;employee_count:number;total_net:number}|null;open_runs:number;without_structure:number}}>(mode==='hrms'&&can('payroll.view_all')?'/api/v1/payroll/dashboard':null);
  const billing=useApi<{data:{summary:{outstanding:number;overdue_amount:number;overdue_count:number;open_invoices:number}}}>(mode==='crm'&&can('billing.view')?'/api/v1/finance/reports':null);
  if(mode==='hrms'&&!can('payroll.view_all')||mode==='crm'&&!can('billing.view'))return null;
  const p=payroll.data?.data;const b=billing.data?.data.summary;
  return <><div className="panel-header" style={{padding:'4px 2px'}}><div><h2>{mode==='hrms'?'Payroll & Compensation':'Client Billing & Payments'}</h2><p>{mode==='hrms'?'Staff salary runs and payslips':'Invoice status and client receivables'}</p></div></div>
    <div className="metric-grid">
      {mode==='hrms'&&<Metric title="Payroll Summary" value={p?(p.latest?money(p.latest.total_net):'No runs'):'—'} note={p?.latest?`${MONTHS[p.latest.period_month-1]} ${p.latest.period_year} · ${p.latest.employee_count} employees · ${p.latest.status}`:'Net pay of the latest run'} icon={Wallet} href="/payroll"/>}
      {mode==='hrms'&&<Metric title="Payroll Runs Open" value={p?p.open_runs:'—'} note={p&&p.without_structure?`${p.without_structure} employees lack a salary structure`:'Awaiting approval or finalization'} icon={Wallet} href="/payroll"/>}
      {mode==='crm'&&<Metric title="Client Outstanding Payments" value={b?money(b.outstanding):'—'} note={b?`${b.open_invoices} open invoices`:'Unpaid balances'} icon={ReceiptText} href="/billing"/>}
      {mode==='crm'&&<Metric title="Overdue Receivables" value={b?money(b.overdue_amount):'—'} note={b?`${b.overdue_count} overdue invoices`:'Past due date'} icon={CircleAlert} href="/billing"/>}
    </div></>;
}

function MyDay() {
  const me=useApi<{data:{record:Record<string,unknown>|null;punched_in:boolean;timezone:string}}>('/api/v1/hr/attendance/me');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const d=me.data?.data;
  async function punch(action:'in'|'out') {
    setBusy(true);setError('');setMessage('');
    try {const result=await requestJson<{message?:string}>('/api/v1/hr/attendance/punch',{method:'POST',body:JSON.stringify({action})});setMessage(result.message||'Attendance updated');me.reload();}
    catch(err){setError(err instanceof Error?err.message:'Unable to update attendance');}
    finally{setBusy(false);}
  }
  return <div className="panel myday-panel"><span className="metric-icon"><Fingerprint size={22}/></span>
    <div className="myday-copy"><b>My attendance today</b><p className="muted">{!d?'Loading…':d.record?`In ${fmtTime(d.record.punch_in,d.timezone)}${d.record.punch_out?` · Out ${fmtTime(d.record.punch_out,d.timezone)}`:' · still on duty'}`:'You have not punched in yet'}</p>{message&&<small className="myday-success" role="status">{message}</small>}{(error||me.error)&&<small className="myday-error" role="alert">{error||me.error}</small>}</div>
    <div className="myday-actions">{d?.record?.punch_out?<Badge value={d.record.status}/>:<button type="button" className={`btn ${d?.punched_in?'ghost':'primary'} small`} disabled={busy||!d} onClick={()=>void punch(d?.punched_in?'out':'in')}>{busy?'Saving…':d?.punched_in?'Punch Out':'Punch In'} <ArrowRight size={14}/></button>}<Link href="/my-attendance" className="btn ghost small">View Details</Link></div>
  </div>;
}

function LeadDashboard(){
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
    <div className="page-heading module-page-heading"><div><p className="eyebrow">SKILLMINT / LEAD MANAGEMENT</p><h1>Lead Management Dashboard</h1><p>Manage employer relationships, candidate pipelines and daily recruitment work.</p></div><Link className="btn primary" href="/company-leads?new=1"><Plus size={16}/> Add Company Lead</Link></div>
    {error&&<div className="alert danger">{error}</div>}
    <ModuleLinks mode="crm"/>
    <div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Recruitment CRM</h2><p>Your pipeline and work priorities</p></div></div>
    <div className="metric-grid">{metrics.map((item,index)=><Metric key={item.title} title={item.title} value={data?item.value:'—'} note={item.note} icon={item.icon} href={['/company-leads','/candidates','/jobs','/applications'][index]}/>)}</div>
    <div className="metric-grid secondary-metrics">
      <Mini icon={CalendarClock} label="Follow-ups Due Today" value={data?.followups_due??'—'} href="/followups"/>
      <Mini icon={CircleAlert} label="Overdue Follow-ups" value={data?.overdue??'—'} href="/followups" warn/>
      <Mini icon={CalendarClock} label="Interviews Today" value={data?.interviews_today??'—'} href="/interviews"/>
      <Mini icon={Users} label="Applications" value={data?.applications??'—'} href="/applications"/>
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
          <Link href="/daily-report"><CheckCircle2 size={20}/><div><b>Submit daily report</b><small>Automatically verified progress</small></div><ChevronRight size={16}/></Link>
        </div>
      </div>
    </div>
    {user.role==='admin' && <div className="dashboard-grid lower-panels"><div className="panel"><div className="panel-header"><h2>Requires Attention</h2></div><div className="attention-row"><CircleAlert size={18}/><span>Potential duplicate resumes</span><Link href="/duplicate-reviews">{data?.exceptions?.duplicate_reviews??'—'} to review</Link></div><div className="attention-row"><CircleAlert size={18}/><span>Unassigned company leads</span><Link href="/company-leads">{data?.exceptions?.unassigned_leads??'—'} records</Link></div></div>
      <div className="panel"><div className="panel-header"><h2>Recent Activity</h2></div><div className="activity-small">{data?.latest?.length?data.latest.slice(0,5).map((x,i)=><div key={String(x.id||i)}><span>{String(x.actor_name||'Recruiter')}</span><b>{String(x.action||x.outcome||'Activity')}</b><small>{formatDate(x.created_at,true)}</small></div>):<p className="muted">No recent activity yet.</p>}</div></div></div>}
    <FinanceSection mode="crm"/>
  </div>;
}

type WorkspaceMode='hrms'|'crm';
type ModuleLink={href:string;title:string;detail:string;icon:LucideIcon;permission?:string;adminOnly?:boolean};
const hrmsLinks:ModuleLink[]=[
  {href:'/hr-employees',title:'Employee Directory',detail:'Staff records and profiles',icon:IdCard,permission:'employees.view'},
  {href:'/my-attendance',title:'My Attendance',detail:'Punch in, punch out and history',icon:Fingerprint},
  {href:'/attendance-register',title:'Attendance Register',detail:'Team attendance and corrections',icon:CalendarCheck,permission:'attendance.view_all'},
  {href:'/shifts',title:'Shift Scheduling',detail:'Create shifts and assign rosters',icon:Clock3,permission:'shifts.manage'},
  {href:'/leave',title:'Leave Management',detail:'Requests, balances and approvals',icon:Plane},
  {href:'/overtime',title:'Overtime',detail:'Extra hours and approvals',icon:Timer},
  {href:'/holidays',title:'Holiday Calendar',detail:'Company holidays and time off',icon:CalendarDays},
  {href:'/payroll',title:'Payroll',detail:'Monthly salary processing',icon:Wallet,permission:'payroll.view_all'},
  {href:'/my-payslips',title:'My Payslips',detail:'View your salary statements',icon:ReceiptText},
  {href:'/analytics',title:'HR Analytics',detail:'Workforce performance reports',icon:BarChart3,permission:'hr.reports'},
];
const crmLinks:ModuleLink[]=[
  {href:'/company-leads',title:'Company Leads',detail:'Employer prospects and deals',icon:BriefcaseBusiness},
  {href:'/clients',title:'Clients & Contacts',detail:'Manage employer relationships',icon:Users},
  {href:'/candidates',title:'Candidates & Resumes',detail:'Manual leads and resume upload',icon:IdCard},
  {href:'/jobs',title:'Job Requisitions',detail:'Open hiring requirements',icon:Layers3},
  {href:'/applications',title:'Applications',detail:'Candidate stages and placements',icon:FileText},
  {href:'/interviews',title:'Interviews',detail:'Schedules and feedback',icon:CalendarDays},
  {href:'/followups',title:'Follow-up Center',detail:'Tasks, reminders and calls',icon:Clock3},
  {href:'/activities',title:'Activity History',detail:'Timeline of lead interactions',icon:CheckCircle2},
  {href:'/daily-report',title:'Daily Report',detail:'Track your daily work',icon:BarChart3},
  {href:'/employees',title:'CRM Team Access',detail:'Recruiters and lead allocation',icon:UserRoundCog,adminOnly:true},
  {href:'/handover',title:'Employee Handover',detail:'Reassign work when staff leave',icon:ArrowRight,adminOnly:true},
  {href:'/duplicate-reviews',title:'Duplicate Reviews',detail:'Check repeated resume records',icon:ShieldCheck,adminOnly:true},
];

function ModuleLinks({mode}:{mode:WorkspaceMode}) {
  const user=useCurrentUser();
  const can=useCan();
  const links=(mode==='hrms'?hrmsLinks:crmLinks).filter(link=>(!link.adminOnly||user.role==='admin')&&(!link.permission||can(link.permission)));
  return <section className="module-directory" aria-label={mode==='hrms'?'HRMS modules':'Lead management modules'}>
    <div className="module-section-heading"><div><span className="eyebrow">QUICK ACCESS</span><h2>{mode==='hrms'?'HRMS Modules':'Recruitment Modules'}</h2><p>Open any workspace tool directly. Your existing records and forms stay connected.</p></div></div>
    <div className="module-directory-grid">{links.map(item=>{const Icon=item.icon;return <Link href={item.href} key={item.href} className="module-link-card"><span className="module-link-icon"><Icon size={22}/></span><span className="module-link-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={18} className="module-link-arrow"/></Link>;})}</div>
  </section>;
}

function HrmsDashboard() {
  const user=useCurrentUser();
  return <div className="page-shell">
    <div className="page-heading module-page-heading"><div><p className="eyebrow">SKILLMINT / HUMAN RESOURCES</p><h1>HRMS Dashboard</h1><p>Welcome, {user.full_name.split(' ')[0]}. Your attendance, team, schedules and leave in one place.</p></div><Link href="/my-attendance" className="btn primary"><Fingerprint size={17}/> Punch In / Out</Link></div>
    <MyDay/>
    <ModuleLinks mode="hrms"/>
    <HrSection/>
    <FinanceSection mode="hrms"/>
  </div>;
}

function WorkspaceChooser() {
  const user=useCurrentUser();
  return <div className="page-shell workspace-chooser">
    <section className="workspace-hero"><div className="workspace-hero-content"><span className="workspace-hero-kicker"><Sparkles size={16}/> THE SKILLMINT WORKSPACE</span><h1>Welcome back, {user.full_name.split(' ')[0]}.</h1><p>Two powerful workspaces. One connected platform. Select where you want to work today.</p></div><span className="workspace-hero-orb" aria-hidden="true"/></section>
    <div className="module-section-heading"><div><span className="eyebrow">YOUR WORKSPACES</span><h2>Choose a workspace</h2><p>Each module has its own dashboard, navigation and day-to-day tools.</p></div></div>
    <div className="workspace-choice-grid">
      <Link href="/hrms-dashboard" className="workspace-choice-card hrms-choice"><div className="workspace-choice-top"><span className="workspace-choice-icon"><Users size={30}/></span><span className="workspace-choice-tag">PEOPLE & OPERATIONS</span></div><h2>HRMS</h2><p>Employee management, punch-in/out, attendance, shifts, leave, overtime, holidays and payroll.</p><div className="workspace-choice-list"><span><Fingerprint size={17}/> Attendance & Punch</span><span><IdCard size={17}/> Employee Directory</span><span><Plane size={17}/> Leaves & Shifts</span><span><Wallet size={17}/> Payroll</span></div><span className="workspace-choice-cta">Enter HRMS <ArrowRight size={19}/></span></Link>
      <Link href="/leads-dashboard" className="workspace-choice-card crm-choice"><div className="workspace-choice-top"><span className="workspace-choice-icon"><BriefcaseBusiness size={30}/></span><span className="workspace-choice-tag">RECRUITMENT & GROWTH</span></div><h2>Lead Management</h2><p>Track company and candidate leads, resumes, jobs, recruitment pipelines and daily follow-ups.</p><div className="workspace-choice-list"><span><BriefcaseBusiness size={17}/> Company Leads</span><span><FileText size={17}/> Candidate Resumes</span><span><Layers3 size={17}/> Hiring Pipeline</span><span><CalendarClock size={17}/> Follow-ups</span></div><span className="workspace-choice-cta">Enter Lead Management <ArrowRight size={19}/></span></Link>
    </div>
    <div className="workspace-footnote"><LockKeyhole size={17}/><span>Both workspaces use the same SkillMint account and permissions. You can switch workspaces anytime.</span></div>
  </div>;
}

export function DashboardView({mode='choose'}:{mode?:WorkspaceMode|'choose'}) {
  if(mode==='hrms')return <HrmsDashboard/>;
  if(mode==='crm')return <LeadDashboard/>;
  return <WorkspaceChooser/>;
}
