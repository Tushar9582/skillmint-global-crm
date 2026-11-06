'use client';

import { FormEvent, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail, ArrowRight, UsersRound, ChartNoAxesCombined } from 'lucide-react';

const demo=process.env.NODE_ENV==='development' && process.env.NEXT_PUBLIC_DEV_DEMO_MODE==='true';

export default function LoginPage() {
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [show,setShow]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const response=await fetch('/api/auth/login',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Sign-in failed');
      window.location.assign(result.user?.must_change_password?'/profile':'/dashboard');
    } catch(err){setError(err instanceof Error?err.message:'Unable to sign in');}
    finally{setBusy(false);}
  }
  return <main className="login-page">
    <section className="login-story">
      <div className="brand white"><img className="brand-mark brand-logo" src="/brand/skillmint-global-mark.png" alt="SkillMint Global logo"/><span><strong>skillmint</strong><small>G L O B A L</small></span></div>
      <div className="login-hero-copy">
        <p className="eyebrow light">RECRUITMENT OPERATIONS, CONNECTED</p>
        <h1>Your people.<br/>Your pipeline.<br/><em>One powerful CRM.</em></h1>
        <p>Manage employer leads, candidate profiles, resumes and follow-ups in one beautiful, secure workspace.</p>
        <div className="login-floats">
          <div className="float-card"><ChartNoAxesCombined size={24}/><span><b>Hiring pipeline</b><small>From first call to placement</small></span></div>
          <div className="float-card mini"><UsersRound size={22}/><span><b>Candidate shortlisted</b><small>Interview scheduled</small></span></div>
        </div>
      </div>
      <div className="login-story-bottom">© 2026 SkillMint Global · Private Recruitment Workspace</div>
    </section>
    <section className="login-form-side">
      <div className="login-form-wrap">
        <p className="eyebrow">WELCOME BACK</p>
        <h2>Sign in to SkillMint</h2>
        <p className="muted">Access your secure recruitment workspace.</p>
        {demo ? <div className="login-form"><div className="alert"><b>Development Mode</b><br/>Authentication is bypassed locally. Changes are saved only in this browser.</div><button className="btn primary full" type="button" onClick={()=>window.location.assign('/dashboard')}>Enter CRM Dashboard <ArrowRight size={16}/></button><div className="login-help"><b>Demo Admin Login</b><br/>Email: {process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL}<br/>Password: {process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD}<br/><small>Shown for UI testing only; no database account is created.</small></div></div> : <form onSubmit={submit} className="login-form">
          <label>Work Email Address<div className="input-icon"><Mail size={18}/><input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" placeholder="you@skillmintglobal.com" required/></div></label>
          <label>Password<div className="input-icon"><LockKeyhole size={18}/><input value={password} onChange={e=>setPassword(e.target.value)} type={show?'text':'password'} autoComplete="current-password" placeholder="Your password" required/><button type="button" className="icon-only" onClick={()=>setShow(!show)} aria-label="Show password">{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          {error && <div className="alert danger" role="alert">{error}</div>}
          <button disabled={busy} className="btn primary full" type="submit">{busy?'Signing in…':'Sign in to Dashboard'} <ArrowRight size={16}/></button>
        </form>}
        <div className="login-help">Employees are registered by the Admin. Contact your Admin for account access or password reset.</div>
      </div>
    </section>
  </main>;
}
