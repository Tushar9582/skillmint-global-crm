'use client';
import { useState,type FormEvent } from 'react';
import Link from 'next/link';
export function RegisterForm(){
 const [email,setEmail]=useState(''),[name,setName]=useState(''),[company,setCompany]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
 const [step,setStep]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function send(event:FormEvent){
  event.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(step===1?{action:'request',email}:{action:'complete',email,fullName:name,companyName:company,password,code})});
   const data=await response.json();if(!response.ok){setError(data.error||'Could not continue');return;}
   setMessage(data.message||'');setStep(step===1?2:3);if(step===2)setPassword('');
  }catch{setError('Could not reach SkillMint. Please try again.');}finally{setBusy(false);}
 }
 return <main className="skillmint-auth"><section className="skillmint-auth-story"><div className="skillmint-auth-story-inner"><div className="skillmint-auth-brand"><img src="/brand/skillmint-global-mark.png" alt="SkillMint" width={54} height={54}/><span><strong>skillmint</strong><small>G L O B A L</small></span></div><div className="skillmint-auth-hero"><p>RECRUITMENT CRM</p><h1>Your company.<br/><em>Your private workspace.</em></h1><p>Manage leads, resumes, interviews and your recruitment team in one place.</p><p>3-day free trial · No card required</p></div></div></section>
 <section className="skillmint-auth-form-side"><div className="skillmint-auth-form-shell"><span className="skillmint-auth-welcome">GET STARTED · {step===3?'COMPLETE':'STEP '+step+' OF 2'}</span><h2>{step===3?'Your workspace is ready':step===1?'Create your workspace':'Verify and create workspace'}</h2>
 <p className="skillmint-auth-subtitle">Employees should sign in using credentials created by their company administrator.</p>
 {message&&<p className="skillmint-auth-subtitle" role="status">{message}</p>}{error&&<p className="skillmint-auth-error" role="alert">{error}</p>}
 {step<3?<form className="skillmint-auth-form" onSubmit={send}>
 <label>Work email<div className="skillmint-auth-input"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} readOnly={step===2} maxLength={254} required/></div></label>
 {step===2&&<><label>Verification code<div className="skillmint-auth-input"><input value={code} onChange={e=>setCode(e.target.value)} autoComplete="one-time-code" required maxLength={64}/></div></label><label>Your full name<div className="skillmint-auth-input"><input value={name} onChange={e=>setName(e.target.value)} required maxLength={150}/></div></label><label>Company name<div className="skillmint-auth-input"><input value={company} onChange={e=>setCompany(e.target.value)} required maxLength={150}/></div></label><label>Password (12+ characters)<div className="skillmint-auth-input"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" required minLength={12} maxLength={72}/></div></label></>}
 <button className="skillmint-auth-submit" disabled={busy}>{busy?'Please wait…':step===1?'Send verification code':'Create my workspace'}</button>
 {step===2&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>{setStep(1);setCode('');setMessage('');setError('');}}>Change email / resend</button>}
 </form>:<Link className="skillmint-auth-submit" href="/login">Sign in to my workspace</Link>}
 <p className="skillmint-auth-help">Already registered? <Link href="/login">Sign in</Link></p></div></section></main>
}
