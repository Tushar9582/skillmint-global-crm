'use client';

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/hr/core';
import { Activity, Bell, BriefcaseBusiness, CalendarDays, ChevronDown, ClipboardList, Clock3, CalendarCheck, Fingerprint, IdCard,
  FileSpreadsheet, FileText, FolderHeart, LayoutDashboard, Layers3, LogOut, Menu, Search, type LucideIcon,
  Settings2, ShieldCheck, Users, UserRoundCog, Workflow, X, Plane, Timer, Wallet, ReceiptText, BarChart3 } from 'lucide-react';
import { DEMO_PEOPLE, getDemoRole, setDemoRole } from '@/lib/hr/demo-hr';
import '@/lib/hr/demo-all';
import { ROLE_LABELS, ROLES, canAny } from '@/lib/hr/core';

export type CurrentUser={id:string;full_name:string;email:string;role:Role;must_change_password:boolean};
const CurrentUserContext=createContext<CurrentUser|null>(null);
export function useCurrentUser(){const user=useContext(CurrentUserContext);if(!user)throw new Error('User context missing');return user;}

type NavItem={href:string;label:string;icon:LucideIcon;group:string;perms?:string[];adminOnly?:boolean};
const CRM='Recruitment CRM',HR='Human Resources',FIN='Finance & Billing',REPORTS='Reports & Analytics';
const allItems:NavItem[]=[
  {href:'/dashboard',label:'Dashboard',icon:LayoutDashboard,group:'Overview'},
  {href:'/company-leads',label:'Company Leads',icon:BriefcaseBusiness,group:CRM},
  {href:'/clients',label:'Clients & Contacts',icon:FolderHeart,group:CRM},
  {href:'/candidates',label:'Candidates & Resume Bank',icon:Users,group:CRM},
  {href:'/jobs',label:'Job Requisitions',icon:Layers3,group:CRM},
  {href:'/applications',label:'Applications',icon:Workflow,group:CRM},
  {href:'/interviews',label:'Interviews',icon:CalendarDays,group:CRM},
  {href:'/followups',label:'Follow-up Center',icon:Clock3,group:CRM},
  {href:'/activities',label:'Activity History',icon:Activity,group:CRM},
  {href:'/employees',label:'CRM Team Access',icon:UserRoundCog,group:CRM,adminOnly:true},
  {href:'/handover',label:'Employee Handover',icon:Workflow,group:CRM,adminOnly:true},
  {href:'/duplicate-reviews',label:'Duplicate Reviews',icon:ShieldCheck,group:CRM,adminOnly:true},
  {href:'/imports',label:'Bulk CSV / Excel Import',icon:FileSpreadsheet,group:CRM,adminOnly:true},
  {href:'/crm-settings',label:'CRM Customization',icon:Settings2,group:CRM,adminOnly:true},
  {href:'/hr-employees',label:'Employee Directory',icon:IdCard,group:HR,perms:['employees.view']},
  {href:'/my-attendance',label:'My Attendance',icon:Fingerprint,group:HR},
  {href:'/attendance-register',label:'Attendance Register',icon:CalendarCheck,group:HR,perms:['attendance.view_all']},
  {href:'/shifts',label:'Shift Scheduling',icon:Clock3,group:HR,perms:['shifts.manage']},
  {href:'/leave',label:'Leave Management',icon:Plane,group:HR},
  {href:'/overtime',label:'Overtime',icon:Timer,group:HR},
  {href:'/holidays',label:'Holiday Calendar',icon:CalendarDays,group:HR},
  {href:'/payroll',label:'Payroll',icon:Wallet,group:FIN,perms:['payroll.view_all']},
  {href:'/billing',label:'Billing & Invoices',icon:ReceiptText,group:FIN,perms:['billing.view']},
  {href:'/my-payslips',label:'My Payslips',icon:ReceiptText,group:FIN},
  {href:'/reports',label:'CRM Reports',icon:Activity,group:CRM,adminOnly:true},
  {href:'/analytics',label:'Reports & Analytics',icon:BarChart3,group:REPORTS,perms:['hr.reports','overtime.manage','payroll.view_all','billing.view']},
  {href:'/audit',label:'Audit Logs',icon:ClipboardList,group:REPORTS,adminOnly:true},
  {href:'/permissions',label:'Role Permissions',icon:Settings2,group:REPORTS,adminOnly:true},
  {href:'/daily-report',label:'My Daily Report',icon:FileText,group:'My Account'},
  {href:'/notifications',label:'Notifications',icon:Bell,group:'My Account'},
  {href:'/profile',label:'My Profile',icon:ShieldCheck,group:'My Account'},
];

export function WorkspaceShell({user:serverUser,children}:{user:CurrentUser;children:ReactNode}) {
  const pathname=usePathname();
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [loggingOut,setLoggingOut]=useState(false);
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
  const demo=process.env.NODE_ENV==='development' && process.env.NEXT_PUBLIC_DEV_DEMO_MODE==='true';
  const stagingDemo=process.env.NODE_ENV==='production' && process.env.NEXT_PUBLIC_DEMO_MODE==='true';
  const [demoRole,setRole]=useState<Role|null>(null);
  useEffect(()=>{if(demo)setRole(getDemoRole());},[demo]);
  if(demo&&!demoRole)return null;
  const person=demo&&demoRole?DEMO_PEOPLE[demoRole]:null;
  const user:CurrentUser=person?{id:person.id,full_name:person.full_name,email:person.email,role:person.role,must_change_password:false}:serverUser;
  const nav=allItems.filter(item=>(!item.adminOnly||user.role==='admin')&&(!item.perms||canAny(user.role,item.perms)));
  let lastGroup='';
  function submitSearch(event:FormEvent) {event.preventDefault();if(search.trim())router.push(`/candidates?q=${encodeURIComponent(search.trim())}`);}
  async function logout() {if(demo){window.location.href='/login';return;}setLoggingOut(true);await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login';}
  const page=nav.find(item=>item.href===pathname)?.label || 'Workspace';
  return <CurrentUserContext.Provider value={user}>
    <div className="app-frame">
      {open&&<button className="mobile-backdrop" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}
      <aside className={`sidebar ${open?'sidebar-open':''}`}>
        <div className="sidebar-brand brand white"><img className="brand-mark brand-logo" src="/brand/skillmint-global-mark.png" alt="SkillMint Global logo"/><span><strong>skillmint</strong><small>G L O B A L</small></span><button className="sidebar-close" onClick={()=>setOpen(false)} aria-label="Close"><X size={20}/></button></div>
        <nav className="nav-scroll" aria-label="CRM navigation">
          {nav.map(item=>{
            const label=lastGroup!==item.group?item.group:null;
            lastGroup=item.group;
            const Icon=item.icon;
            return <div key={item.href}>
              {label&&<button className="nav-group" onClick={()=>setCollapsed(value=>({...value,[item.group]:!value[item.group]}))}>{label}<ChevronDown size={14} className={collapsed[item.group]?'nav-chevron collapsed':'nav-chevron'}/></button>}
              {!collapsed[item.group]&&<Link onClick={()=>setOpen(false)} href={item.href} className={`nav-link ${pathname===item.href?'active':''}`}><Icon size={18}/><span>{item.label}</span></Link>}
            </div>;
          })}
        </nav>
        <div className="sidebar-bottom">{demo?<div className="cloud-chip"><span className="status-dot"/>DEVELOPMENT MODE<small>Browser-local demo data</small><select className="role-switch" aria-label="Demo role" value={demoRole||'admin'} onChange={e=>{setDemoRole(e.target.value as Role);window.location.reload();}}>{ROLES.map(r=><option key={r} value={r}>View as: {ROLE_LABELS[r]}</option>)}</select></div>:stagingDemo?<div className="cloud-chip"><span className="status-dot"/>ISOLATED DEMO MODE<small>Browser-local simulated data</small></div>:<div className="cloud-chip"><span className="status-dot"/>SECURE CLOUD WORKSPACE<small>Private recruitment data</small></div>}
          <div className="side-user"><span className="avatar">{user.full_name.slice(0,2).toUpperCase()}</span><span><b>{user.full_name}</b><small>{ROLE_LABELS[user.role]}</small></span><button onClick={logout} disabled={loggingOut} title="Sign out"><LogOut size={16}/></button></div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar"><div className="topbar-leading"><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Open menu"><Menu size={22}/></button><div className="breadcrumbs">Workspace <span>/</span><b>{page}</b></div></div>
          <div className="topbar-actions"><form className="global-search" onSubmit={submitSearch}><Search size={16}/><input placeholder="Search candidates…" value={search} onChange={event=>setSearch(event.target.value)}/></form><span className="topbar-cloud"><span className="status-dot"/>{stagingDemo?'ISOLATED DEMO':'SECURE CLOUD'}</span><Link href="/notifications" className="top-icon" aria-label="Notifications"><Bell size={19}/></Link><Link href="/profile" className="top-avatar">{user.full_name.charAt(0).toUpperCase()}</Link></div>
        </header>
        {user.must_change_password && <div className="password-banner">Your account has a temporary password. Please <Link href="/profile">change your password</Link> before working with records.</div>}
        <div className="content-area">{children}</div>
      </div>
    </div>
  </CurrentUserContext.Provider>;
}
