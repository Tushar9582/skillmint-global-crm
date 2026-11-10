'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleAlert, BriefcaseBusiness, Users, Layers3, CheckCircle2, Plus, ChevronRight,
  ReceiptText, IdCard, CalendarDays, Clock3, FileText, UserRoundCog, ShieldCheck, BarChart3, type LucideIcon } from 'lucide-react';
import { requestJson, formatDate } from '@/lib/client-api';
import { money, useApi, useCan } from './hr/ui';
import { useCurrentUser } from './workspace-shell';

type Dashboard={company_leads:number;candidates:number;jobs:number;applications:number;
  interviews_today:number;followups_due:number;overdue:number;placements:number;
  queue:Array<{id:string;title:string;due_at:string;priority:string;owner_name:string}>;
  latest:Array<Record<string,string>>;exceptions?:{duplicate_reviews:number;unassigned_leads:number}|null};

function Metric({title,value,note,icon:Icon,href}:{title:string;value:ReactNode;note:string;icon:LucideIcon;href:string}){
  return <Link href={href} className="metric-card" style={{display:'block'}}><div className="metric-label"><span>{title}</span><span className="metric-icon"><Icon size={18}/></span></div><div className="metric-number">{value}</div><p>{note}</p></Link>;
}

function Mini({icon:Icon,label,value,href,warn}:{icon:LucideIcon;label:string;value:ReactNode;href:string;warn?:boolean}){
  return <Link href={href} className={`mini-metric ${warn?'warn':''}`}><Icon size={19}/><span>{label}</span><strong>{value}</strong></Link>;
}

type ModuleLink={href:string;title:string;detail:string;icon:LucideIcon;adminOnly?:boolean};
const crmLinks:ModuleLink[]=[
  {href:'/company-leads',title:'Company Leads',detail:'Employer prospects and deals',icon:BriefcaseBusiness},
  {href:'/clients',title:'Clients & Contacts',detail:'Manage employer relationships',icon:Users},
  {href:'/candidates',title:'Candidates & Resumes',detail:'Create leads manually or from saved resumes',icon:IdCard},
  {href:'/jobs',title:'Job Requisitions',detail:'Open hiring requirements',icon:Layers3},
  {href:'/applications',title:'Applications',detail:'Candidate stages and placements',icon:FileText},
  {href:'/interviews',title:'Interviews',detail:'Schedules and feedback',icon:CalendarDays},
  {href:'/followups',title:'Follow-up Center',detail:'Tasks, reminders and calls',icon:Clock3},
  {href:'/activities',title:'Activity History',detail:'Timeline of lead interactions',icon:CheckCircle2},
  {href:'/daily-report',title:'Daily Report',detail:'Track your daily recruitment work',icon:BarChart3},
  {href:'/employees',title:'CRM Team Access',detail:'Recruiters and lead allocation',icon:UserRoundCog,adminOnly:true},
  {href:'/handover',title:'Employee Handover',detail:'Reassign leads when staff leave',icon:ArrowRight,adminOnly:true},
  {href:'/duplicate-reviews',title:'Duplicate Reviews',detail:'Check repeated candidate resumes',icon:ShieldCheck,adminOnly:true},
];

function ModuleLinks(){
  const user=useCurrentUser();
  return <section className="module-directory" aria-label="Lead management modules">
    <div className="module-section-heading"><div><span className="eyebrow">QUICK ACCESS</span><h2>Recruitment Modules</h2><p>Open any lead management tool. Your records and forms stay connected.</p></div></div>
    <div className="module-directory-grid">{crmLinks.filter(link=>!link.adminOnly||user.role==='admin').map(item=>{const Icon=item.icon;return <Link href={item.href} key={item.href} className="module-link-card"><span className="module-link-icon"><Icon size={22}/></span><span className="module-link-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={18} className="module-link-arrow"/></Link>;})}</div>
  </section>;
}

function ClientBilling(){
  const can=useCan();
  const billing=useApi<{data:{summary:{outstanding:number;overdue_amount:number;overdue_count:number;open_invoices:number}}}>(can('billing.view')?'/api/v1/finance/reports':null);
  if(!can('billing.view'))return null;
  const summary=billing.data?.data.summary;
  return <><div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Client Billing & Payments</h2><p>Invoice status and client receivables</p></div></div>
    <div className="metric-grid">
      <Metric title="Client Outstanding Payments" value={summary?money(summary.outstanding):'—'} note={summary?`${summary.open_invoices} open invoices`:'Unpaid balances'} icon={ReceiptText} href="/billing"/>
      <Metric title="Overdue Receivables" value={summary?money(summary.overdue_amount):'—'} note={summary?`${summary.overdue_count} overdue invoices`:'Past due date'} icon={CircleAlert} href="/billing"/>
    </div></>;
}

export function DashboardView(){
  const user=useCurrentUser();
  const [data,setData]=useState<Dashboard|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Dashboard}>('/api/v1/dashboard').then(v=>setData(v.data)).catch(e=>setError(e instanceof Error?e.message:'Unable to load dashboard'));},[]);
  const metrics=[
    {title:user.role==='admin'?'Company Leads':'My Company Leads',value:data?.company_leads,icon:BriefcaseBusiness,note:'Employer pipeline',href:'/company-leads'},
    {title:user.role==='admin'?'Candidate Leads':'My Candidates',value:data?.candidates,icon:Users,note:'Candidate talent bank',href:'/candidates'},
    {title:'Active Jobs',value:data?.jobs,icon:Layers3,note:'Open job requisitions',href:'/jobs'},
    {title:'Joined / Placements',value:data?.placements,icon:CheckCircle2,note:'Successful hires',href:'/applications'},
  ];
  return <div className="page-shell">
    <div className="page-heading module-page-heading"><div><p className="eyebrow">SKILLMINT / LEAD MANAGEMENT</p><h1>Lead Management Dashboard</h1><p>Manage employer relationships, candidate pipelines, resumes and daily recruitment work.</p></div><Link className="btn primary" href="/company-leads?new=1"><Plus size={16}/> Add Company Lead</Link></div>
    {error&&<div className="alert danger" role="alert">{error}</div>}
    <ModuleLinks/>
    <div className="panel-header" style={{padding:'4px 2px'}}><div><h2>Recruitment Overview</h2><p>Your pipeline and work priorities</p></div></div>
    <div className="metric-grid">{metrics.map(item=><Metric key={item.title} title={item.title} value={data?item.value:'—'} note={item.note} icon={item.icon} href={item.href}/>)}</div>
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
      <div className="panel"><div className="panel-header"><div><h2>Quick Actions</h2><p>Common recruitment tasks</p></div></div>
        <div className="quick-actions">
          <Link href="/company-leads?new=1"><BriefcaseBusiness size={20}/><div><b>Create company lead</b><small>Register an employer prospect</small></div><ChevronRight size={16}/></Link>
          <Link href="/candidates?new=1"><Users size={20}/><div><b>Add candidate manually</b><small>Enter candidate details in a form</small></div><ChevronRight size={16}/></Link>
          <Link href="/candidates?mode=resume"><FileText size={20}/><div><b>Upload candidate resume</b><small>Extract details and save the file with the lead</small></div><ChevronRight size={16}/></Link>
          <Link href="/followups?new=1"><CalendarClock size={20}/><div><b>Schedule a follow-up</b><small>Track your next contact</small></div><ChevronRight size={16}/></Link>
          <Link href="/daily-report"><CheckCircle2 size={20}/><div><b>Submit daily report</b><small>Automatically verified progress</small></div><ChevronRight size={16}/></Link>
        </div>
      </div>
    </div>
    {user.role==='admin'&&<div className="dashboard-grid lower-panels"><div className="panel"><div className="panel-header"><h2>Requires Attention</h2></div><div className="attention-row"><CircleAlert size={18}/><span>Potential duplicate resumes</span><Link href="/duplicate-reviews">{data?.exceptions?.duplicate_reviews??'—'} to review</Link></div><div className="attention-row"><CircleAlert size={18}/><span>Unassigned company leads</span><Link href="/company-leads">{data?.exceptions?.unassigned_leads??'—'} records</Link></div></div>
      <div className="panel"><div className="panel-header"><h2>Recent Activity</h2></div><div className="activity-small">{data?.latest?.length?data.latest.slice(0,5).map((x,i)=><div key={String(x.id||i)}><span>{String(x.actor_name||'Recruiter')}</span><b>{String(x.action||x.outcome||'Activity')}</b><small>{formatDate(x.created_at,true)}</small></div>):<p className="muted">No recent activity yet.</p>}</div></div></div>}
    <ClientBilling/>
  </div>;
}
