
'use client';
import {useState,type FormEvent,type ChangeEvent} from 'react';
import {useRouter} from 'next/navigation';
import {Building2,ImagePlus,Save,ShieldCheck,Upload,Trash2} from 'lucide-react';
import type {CompanyProfile} from '@/lib/company-profile';
type Field=Exclude<keyof CompanyProfile,'has_logo'|'updated_at'>;
const groups:{title:string;hint:string;fields:{key:Field;label:string;max:number;type?:string;placeholder?:string}[]}[]=[
 {title:'Company information',hint:'Your workspace identity and business information.',fields:[{key:'display_name',label:'Company / brand name',max:150},{key:'legal_name',label:'Registered legal name',max:200},{key:'industry',label:'Industry',max:120},{key:'website',label:'Website',max:300,type:'url',placeholder:'https://example.com'}]},
 {title:'Contact & address',hint:'Business contact information shared with your own team.',fields:[{key:'contact_email',label:'Company email',max:254,type:'email'},{key:'phone',label:'Phone number',max:40,type:'tel'},{key:'address',label:'Office address',max:500},{key:'city',label:'City',max:100},{key:'state',label:'State / region',max:100},{key:'postal_code',label:'Postal code',max:30},{key:'country',label:'Country',max:100}]},
 {title:'Business registration',hint:'Optional company information.',fields:[{key:'tax_id',label:'GST / tax ID',max:80},{key:'registration_number',label:'Company registration number',max:100},{key:'description',label:'About the company',max:1500}]}
];
export function CompanySettings({initial}:{initial:CompanyProfile}){
 const router=useRouter(),[p,setP]=useState(initial),[logo,setLogo]=useState<string|null|undefined>(),[busy,setBusy]=useState(false),[processing,setProcessing]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const image=logo===null?null:logo?'data:image/png;base64,'+logo:p.has_logo?'/api/v1/company-profile/logo?v='+encodeURIComponent(p.updated_at||'') : null;
 async function upload(e:ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';if(!file)return;setError('');setMessage('');setProcessing(true);
  let url='';
  try{
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Choose a PNG, JPG or WebP image up to 5 MB.');
   url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();
   if(img.naturalWidth>10000||img.naturalHeight>10000)throw Error('Image dimensions are too large.');
   const scale=Math.min(1,512/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing unavailable.');
   ctx.drawImage(img,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/png').split(',')[1];
   while(data.length>341000&&canvas.width>32&&canvas.height>32){const copy=document.createElement('canvas');copy.width=Math.round(canvas.width*.75);copy.height=Math.round(canvas.height*.75);copy.getContext('2d')!.drawImage(canvas,0,0,copy.width,copy.height);canvas.width=copy.width;canvas.height=copy.height;canvas.getContext('2d')!.drawImage(copy,0,0);data=canvas.toDataURL('image/png').split(',')[1];}
   if(!data||data.length>341000)throw Error('Please use a simpler or smaller logo.');setLogo(data);
  }catch(e){setError(e instanceof Error?e.message:'Unable to process logo.');}finally{if(url)URL.revokeObjectURL(url);setProcessing(false);}
 }
 async function save(e:FormEvent){e.preventDefault();if(busy||processing)return;setBusy(true);setError('');setMessage('');try{const r=await fetch('/api/v1/company-profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p,logo})});const d=await r.json();if(!r.ok)throw Error(d.error||'Unable to save');setP(d.data);setLogo(undefined);setMessage('Company settings saved. Your team will see the updated branding.');router.refresh();}catch(e){setError(e instanceof Error?e.message:'Unable to save settings');}finally{setBusy(false);}}
 return <form className="hd-company-settings" onSubmit={save}><header className="hd-settings-heading"><div><p className="eyebrow">WORKSPACE / SETTINGS</p><h1>Company Settings</h1><p>Personalize your recruitment workspace and manage your company's details.</p></div><button className="btn primary" disabled={busy||processing}><Save size={17}/> {busy?'Saving…':'Save changes'}</button></header>
 <div className="hd-settings-notice"><ShieldCheck size={20}/><span><b>Private company workspace</b><small>Only your company Admin can edit this information. Branding is shared with your own employees.</small></span></div>
 {error&&<div role="alert" className="skillmint-auth-error">{error}</div>}{message&&<div role="status" className="hd-settings-notice">{message}</div>}
 <section className="hd-settings-card"><h2>Company branding</h2><p>Upload your logo to personalize your team’s sidebar.</p><div className="hd-logo-row"><div className="hd-logo-preview">{image?<img src={image} alt="Company logo"/>:<Building2 size={42}/>}</div><div className="hd-logo-actions"><label className="btn ghost"><Upload size={16}/> {processing?'Processing…':'Upload logo'}<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy||processing}/></label>{image&&<button type="button" className="btn ghost" onClick={()=>setLogo(null)} disabled={busy||processing}><Trash2 size={16}/> Remove</button>}<small>PNG, JPG or WebP · Up to 5 MB · Square logo recommended</small></div><div className="hd-brand-preview"><caption>Sidebar preview</caption><div>{image?<img src={image} alt=""/>:<img src="/brand/hrdiary-mark.svg" alt=""/>}<span><b>{p.display_name||'Your company'}</b><small>POWERED BY HRDIARY</small></span></div></div></div></section>
 {groups.map(g=><section className="hd-settings-card" key={g.title}><h2>{g.title}</h2><p>{g.hint}</p><div className="hd-settings-grid">{g.fields.map(field=><label key={field.key} className={'hd-settings-field '+(['address','description'].includes(field.key)?'wide':'')}><span>{field.label}{field.key==='display_name'?' *':''}</span>{['address','description'].includes(field.key)?<textarea className="form-input" rows={3} value={p[field.key]} maxLength={field.max} onChange={e=>setP({...p,[field.key]:e.target.value})}/>:<input className="form-input" type={field.type||'text'} required={field.key==='display_name'} placeholder={field.placeholder} value={p[field.key]} maxLength={field.max} onChange={e=>setP({...p,[field.key]:e.target.value})}/>}</label>)}</div></section>)}
 <footer className="hd-settings-footer"><small>{p.updated_at?'Last saved: '+new Date(p.updated_at).toLocaleString('en-IN'):'Company profile not yet saved'}</small><button className="btn primary" disabled={busy||processing}><Save size={16}/> {busy?'Saving…':'Save changes'}</button></footer></form>
}
