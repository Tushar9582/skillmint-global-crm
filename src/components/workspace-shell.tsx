'use client';

import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/hr/core';
import { Bell, BriefcaseBusiness, CalendarDays, Clock3, LayoutDashboard, LogOut, Menu,
  Search, ShieldCheck, Sparkles, Users, UserRoundCog, Workflow, X, type LucideIcon } from 'lucide-react';
import { DEMO_PEOPLE, getDemoRole, setDemoRole } from '@/lib/hr/demo-hr';
import '@/lib/hr/demo-all';
import { ROLE_LABELS, ROLES } from '@/lib/hr/core';

export type CurrentUser={id:string;full_name:string;email:string;role:Role;must_change_password:boolean};
const CurrentUserContext=createContext<CurrentUser|null>(null);
export function useCurrentUser(){const user=useContext(CurrentUserContext);if(!user)throw new Error('User context missing');return user;}

type NavItem={href:string;label:string;icon:LucideIcon;adminOnly?:boolean};
// Keep prerequisite and reporting routes available for existing records, while
// presenting just the core recruitment tools and the dedicated AI resume studio.
const navItems:NavItem[]=[
  {href:'/company-leads',label:'Company Leads',icon:BriefcaseBusiness},
  {href:'/candidates',label:'Lead Bank & Resumes',icon:Users},
  {href:'/ai-resume-builder',label:'AI Resume Builder',icon:Sparkles},
  {href:'/applications',label:'Applications',icon:Workflow},
  {href:'/interviews',label:'Interviews',icon:CalendarDays},
  {href:'/followups',label:'Follow-up Center',icon:Clock3},
  {href:'/employees',label:'Employee Management',icon:UserRoundCog,adminOnly:true},
  {href:'/duplicate-reviews',label:'Duplicate Resume Review',icon:ShieldCheck,adminOnly:true},
];
const pageTitles:Record<string,string>={
  '/dashboard':'Lead Dashboard','/notifications':'Notifications','/profile':'My Profile',
  '/clients':'Client Setup','/jobs':'Job Requirement Setup',
};

export function WorkspaceShell({user:serverUser,children}:{user:CurrentUser;children:ReactNode}) {
  const pathname=usePathname();
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [search,setSearch]=useState('');
  const [loggingOut,setLoggingOut]=useState(false);
  const demo=process.env.NODE_ENV==='development' && process.env.NEXT_PUBLIC_DEV_DEMO_MODE==='true';
  const stagingDemo=process.env.NODE_ENV==='production' && process.env.NEXT_PUBLIC_DEMO_MODE==='true';
  const directDemo=demo || process.env.NEXT_PUBLIC_DEMO_AUTO_ACCESS==='true';
  const [demoRole,setRole]=useState<Role|null>(null);
  useEffect(()=>{if(demo)setRole(getDemoRole());},[demo]);
  if(demo&&!demoRole)return null;
  const person=demo&&demoRole?DEMO_PEOPLE[demoRole]:null;
  const user:CurrentUser=person?{id:person.id,full_name:person.full_name,email:person.email,role:person.role,must_change_password:false}:serverUser;
  const nav=navItems.filter(item=>!item.adminOnly||user.role==='admin');
  function submitSearch(event:FormEvent) {event.preventDefault();if(search.trim())router.push(`/candidates?q=${encodeURIComponent(search.trim())}`);}
  async function logout() {if(demo){window.location.href='/login';return;}setLoggingOut(true);await fetch('/api/auth/logout',{method:'POST'});window.location.href='/login';}
  const page=navItems.find(item=>item.href===pathname)?.label||pageTitles[pathname]||'Workspace';
  return <CurrentUserContext.Provider value={user}>
    <div className="app-frame">
      {open&&<button className="mobile-backdrop" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}
      <aside className={`sidebar ${open?'sidebar-open':''}`}>
        <div className="sidebar-brand brand white"><img className="brand-mark brand-logo" src="/brand/skillmint-global-mark.png" alt="SkillMint Global logo"/><span><strong>skillmint</strong><small>G L O B A L</small></span><button className="sidebar-close" onClick={()=>setOpen(false)} aria-label="Close"><X size={20}/></button></div>
        <Link href="/dashboard" onClick={()=>setOpen(false)} className="workspace-switch"><LayoutDashboard size={18}/><span>Lead Dashboard</span><span className="workspace-switch-arrow">↗</span></Link>
        <div className="sidebar-workspace-label">Lead Management<small>Recruitment & client pipeline</small></div>
        <nav className="nav-scroll" aria-label="CRM navigation">
          {nav.map((item,index)=>{const Icon=item.icon;return <div key={item.href}>
            {(index===0||item.adminOnly&&!nav[index-1]?.adminOnly)&&<div className="nav-group nav-group-static">{item.adminOnly?'Administration':'Recruitment CRM'}</div>}
            <Link onClick={()=>setOpen(false)} href={item.href} className={`nav-link ${pathname===item.href?'active':''}`}><Icon size={18}/><span>{item.label}</span></Link>
          </div>;})}
        </nav>
        <div className="sidebar-bottom">{demo?<div className="cloud-chip"><span className="status-dot"/>DEVELOPMENT MODE<small>Browser-local demo data</small><select className="role-switch" aria-label="Demo role" value={demoRole||'admin'} onChange={e=>{setDemoRole(e.target.value as Role);window.location.reload();}}>{ROLES.map(r=><option key={r} value={r}>View as: {ROLE_LABELS[r]}</option>)}</select></div>:stagingDemo?<div className="cloud-chip"><span className="status-dot"/>ISOLATED DEMO MODE<small>Browser-local simulated data</small></div>:<div className="cloud-chip"><span className="status-dot"/>SECURE CLOUD WORKSPACE<small>Private recruitment data</small></div>}
          <div className="side-user"><span className="avatar">{user.full_name.slice(0,2).toUpperCase()}</span><span><b>{user.full_name}</b><small>{ROLE_LABELS[user.role]}</small></span>{!directDemo&&<button onClick={logout} disabled={loggingOut} title="Sign out"><LogOut size={16}/></button>}</div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar"><div className="topbar-leading"><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Open menu"><Menu size={22}/></button><div className="breadcrumbs"><Link href="/dashboard">Lead Management</Link><span>/</span><b>{page}</b></div></div>
<div className="topbar-actions"><form className="global-search" onSubmit={submitSearch}><Search size={16}/><input placeholder="Search candidates…" value={search} onChange={event=>setSearch(event.target.value)}/></form><span className="topbar-cloud"><span className="status-dot"/>{demo?'LOCAL DEMO':stagingDemo?'ISOLATED DEMO':'SECURE CLOUD'}</span><Link href="/notifications" className="top-icon" aria-label="Notifications"><Bell size={19}/></Link><Link href="/profile" className="top-avatar">{user.full_name.charAt(0).toUpperCase()}</Link></div>
        </header>
        {user.must_change_password && <div className="password-banner">Your account has a temporary password. Please <Link href="/profile">change your password</Link> before working with records.</div>}
        <div className="content-area">{children}</div>
      </div>
    </div>
  </CurrentUserContext.Provider>;
}
