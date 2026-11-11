'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, CircleAlert, BriefcaseBusiness, Users, Layers3, CheckCircle2, Plus, ChevronRight,
  IdCard, CalendarDays, Clock3, FileText, Sparkles, UserRoundCog, ShieldCheck, type LucideIcon } from 'lucide-react';
import { requestJson, formatDate } from '@/lib/client-api';
import { useCurrentUser } from './workspace-shell';
import { RecruiterProgressPanel } from './recruiter-progress-panel';

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
  {href:'/company-leads',title:'Company Leads',detail:'Find employers, update status and assign ownership',icon:BriefcaseBusiness},
  {href:'/candidates',title:'Lead Bank & Resumes',detail:'Add candidates, upload resumes and view saved files',icon:IdCard},
  {href:'/ai-resume-builder',title:'AI Resume Builder',detail:'Create, improve, preview and export polished resumes',icon:Sparkles},
  {href:'/followups',title:'Follow-up Center',detail:'Plan calls, meetings and next actions',icon:Clock3},
  {href:'/applications',title:'Applications',detail:'Match candidates with jobs and track progress',icon:FileText},
  {href:'/interviews',title:'Interviews',detail:'Schedule interviews, record feedback and outcomes',icon:CalendarDays},
  {href:'/employees',title:'Employee Management',detail:'Manage recruiters, assignments and daily progress',icon:UserRoundCog,adminOnly:true},
  {href:'/duplicate-reviews',title:'Duplicate Resume Review',detail:'Review possible duplicate candidate resumes',icon:ShieldCheck,adminOnly:true},
];

function ModuleLinks(){
  const user=useCurrentUser();
  return <section className="module-directory" aria-label="Lead management modules">
    <div className="module-section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>{user.role==='admin'?'Recruitment Tools':'Recruitment Essentials'}</h2><p>Start with company or candidate leads, build professional resumes, assign follow-ups and progress through applications and interviews.</p></div></div>
    <div className="module-directory-grid">{crmLinks.filter(link=>!link.adminOnly||user.role==='admin').map(item=>{const Icon=item.icon;return <Link href={item.href} key={item.href} className="module-link-card"><span className="module-link-icon"><Icon size={22}/></span><span className="module-link-copy"><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={18} className="module-link-arrow"/></Link>;})}</div>
  </section>;
}

export function DashboardView(){
  const user=useCurrentUser();
  const [data,setData]=useState<Dashboard|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{requestJson<{data:Dashboard}>('/api/v1/dashboard').then(v=>setData(v.data)).catch(e=>setError(e instanceof Error?e.message:'Unable to load dashboard'));},[]);
  const metrics=[
    {title:user.role==='admin'?'Company Leads':'My Company Leads',value:data?.company_leads,icon:BriefcaseBusiness,note:'Employer pipeline',href:'/company-leads'},
    {title:user.role==='admin'?'Candidate Leads':'My Candidates',value:data?.candidates,icon:Users,note:'Candidate talent bank',href:'/candidates'},
    {title:'Applications',value:data?.applications,icon:Layers3,note:'Candidates submitted for openings',href:'/applications'},
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
      <Mini icon={BriefcaseBusiness} label="Active Job Openings" value={data?.jobs??'—'} href="/applications"/>
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
          <Link href="/ai-resume-builder"><Sparkles size={20}/><div><b>Create professional resume</b><small>Build, enhance and export a candidate resume</small></div><ChevronRight size={16}/></Link>
          <Link href="/followups?new=1"><CalendarClock size={20}/><div><b>Schedule a follow-up</b><small>Track your next contact</small></div><ChevronRight size={16}/></Link>
        </div>
      </div>
    </div>
    {user.role==='admin'&&<RecruiterProgressPanel/>}
    {user.role==='admin'&&<div className="dashboard-grid lower-panels"><div className="panel"><div className="panel-header"><h2>Requires Attention</h2></div><div className="attention-row"><CircleAlert size={18}/><span>Potential duplicate resumes</span><Link href="/duplicate-reviews">{data?.exceptions?.duplicate_reviews??'—'} to review</Link></div><div className="attention-row"><CircleAlert size={18}/><span>Unassigned company leads</span><Link href="/company-leads">{data?.exceptions?.unassigned_leads??'—'} records</Link></div></div>
      <div className="panel"><div className="panel-header"><h2>Recent Activity</h2></div><div className="activity-small">{data?.latest?.length?data.latest.slice(0,5).map((x,i)=><div key={String(x.id||i)}><span>{String(x.actor_name||'Recruiter')}</span><b>{String(x.action||x.outcome||'Activity')}</b><small>{formatDate(x.created_at,true)}</small></div>):<p className="muted">No recent activity yet.</p>}</div></div></div>}
  </div>;
}
