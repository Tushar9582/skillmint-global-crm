'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, ChevronDown, Download, FilePlus2, FileText, Loader2, Plus, Save,
  Sparkles, Trash2, UserRoundSearch, WandSparkles } from 'lucide-react';
import { requestJson } from '@/lib/client-api';
import { isDemoClient } from '@/lib/demo-client';
import { candidateResumeFields, createResumeDraft, isResumeDraft, resumeLines, resumeSkills,
  safeResumeUrl, starterResumeSummary, type ResumeDraft, type ResumeEducation, type ResumeExperience, type ResumeProject } from '@/lib/resume-builder';
import { useCurrentUser } from './workspace-shell';

type EditorTab='personal'|'experience'|'education'|'ai';
type Candidate=Record<string,unknown>;
type AiSuggestion={summary:string;experience:Array<{id:string;bullets:string[]}>};

const tabs:Array<{id:EditorTab;label:string}>=[
  {id:'personal',label:'Personal & Skills'},{id:'experience',label:'Experience'},
  {id:'education',label:'Education & Projects'},{id:'ai',label:'AI Enhancement'},
];

function Field({label,value,onChange,placeholder='',type='text'}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;type?:string}) {
  return <label className="resume-editor-field"><span>{label}</span><input className="form-input" type={type} value={value} placeholder={placeholder} onChange={event=>onChange(event.target.value)}/></label>;
}

function Multi({label,value,onChange,placeholder,rows=4,hint}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;rows?:number;hint?:string}) {
  return <label className="resume-editor-field"><span>{label}</span>{hint&&<small>{hint}</small>}<textarea className="form-input" rows={rows} value={value} placeholder={placeholder} onChange={event=>onChange(event.target.value)}/></label>;
}

function ResumePreview({draft}:{draft:ResumeDraft}) {
  const skills=resumeSkills(draft.skills),certifications=resumeLines(draft.certifications);
  const summary=draft.summary.trim();
  const experiences=draft.experience.filter(item=>item.role||item.company||item.details);
  const education=draft.education.filter(item=>item.degree||item.institution);
  const projects=draft.projects.filter(item=>item.name||item.details);
  const linkedIn=safeResumeUrl(draft.linkedin),portfolio=safeResumeUrl(draft.portfolio);
  return <article id="resume-print-area" className={`resume-paper resume-paper-${draft.template}`} aria-label="Live resume preview">
    <header className="resume-paper-header">
      <h1>{draft.fullName.trim()||'Your Name'}</h1>
      <p>{draft.professionalTitle.trim()||'Professional Title'}</p>
      <div className="resume-paper-contact">
        {[draft.email,draft.phone,draft.location].filter(Boolean).map((text,i)=><span key={i}>{text}</span>)}
        {linkedIn&&<a href={linkedIn} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
        {portfolio&&<a href={portfolio} target="_blank" rel="noopener noreferrer">Portfolio</a>}
      </div>
    </header>
    {summary&&<section className="resume-paper-section"><h2>Professional Summary</h2><p className="resume-paper-copy">{summary}</p></section>}
    {skills.length>0&&<section className="resume-paper-section"><h2>Key Skills</h2><div className="resume-paper-skills">{skills.map((skill,index)=><span key={`${skill}-${index}`}>{skill}</span>)}</div></section>}
    {experiences.length>0&&<section className="resume-paper-section"><h2>Professional Experience</h2>{experiences.map(row=><div key={row.id} className="resume-paper-entry">
      <div className="resume-paper-entry-head"><strong>{row.role||'Position'}{row.company?` · ${row.company}`:''}</strong><small>{row.period}</small></div>
      {resumeLines(row.details).length>0&&<ul>{resumeLines(row.details).map((line,index)=><li key={`${row.id}-${index}`}>{line}</li>)}</ul>}
    </div>)}</section>}
    {education.length>0&&<section className="resume-paper-section"><h2>Education</h2>{education.map(row=><div className="resume-paper-entry" key={row.id}>
      <div className="resume-paper-entry-head"><strong>{row.degree||'Qualification'}</strong><small>{row.year}</small></div>
      <p>{row.institution}</p>
    </div>)}</section>}
    {projects.length>0&&<section className="resume-paper-section"><h2>Projects</h2>{projects.map(row=><div className="resume-paper-entry" key={row.id}><strong>{row.name}</strong><p>{row.details}</p></div>)}</section>}
    {certifications.length>0&&<section className="resume-paper-section"><h2>Certifications</h2><ul>{certifications.map((line,i)=><li key={i}>{line}</li>)}</ul></section>}
    {!summary&&!skills.length&&!experiences.length&&!education.length&&!projects.length&&<div className="resume-paper-placeholder">Your professional resume will appear here as you complete the form.</div>}
  </article>;
}

export function AiResumeBuilderPage() {
  const user=useCurrentUser();
  const storageKey=`skillmint-resume-studio:${user.id}`;
  const [draft,setDraft]=useState<ResumeDraft>(()=>createResumeDraft());
  const [drafts,setDrafts]=useState<ResumeDraft[]>([]);
  const [ready,setReady]=useState(false);
  const [saved,setSaved]=useState(false);
  const [tab,setTab]=useState<EditorTab>('personal');
  const [candidates,setCandidates]=useState<Candidate[]>([]);
  const [candidateToImport,setCandidateToImport]=useState('');
  const [aiBusy,setAiBusy]=useState(false);
  const [aiError,setAiError]=useState('');
  const [aiSuggestion,setAiSuggestion]=useState<AiSuggestion|null>(null);
  const [notice,setNotice]=useState('');
  const demo=isDemoClient();

  useEffect(()=>{
    let cancelled=false;
    async function loadDrafts(){
      let existing:ResumeDraft[]=[];
      if(demo) {
        try {
          const parsed:unknown=JSON.parse(localStorage.getItem(storageKey)||'[]');
          if(Array.isArray(parsed))existing=parsed.filter(isResumeDraft).slice(0,20);
        }catch{/* Ignore unavailable demo browser storage. */}
      } else {
        try {
          const result=await requestJson<{data:ResumeDraft[]}>('/api/v1/resume-drafts');
          existing=(result.data||[]).filter(isResumeDraft).slice(0,20);
        }catch(error) {
          if(!cancelled)setNotice(error instanceof Error?error.message:'Cloud resume drafts could not be loaded.');
          if(!cancelled)setReady(false);
          return;
        }
      }
      if(cancelled)return;
      const initial=existing[0]||createResumeDraft();
      setDrafts(existing.length?existing:[initial]);setDraft(initial);setSaved(true);setReady(true);
    }
    void loadDrafts();
    return ()=>{cancelled=true;};
  },[storageKey,demo]);

  useEffect(()=>{
    requestJson<{data:Candidate[]}>('/api/v1/candidates?limit=100')
      .then(result=>setCandidates(result.data||[])).catch(()=>setCandidates([]));
  },[]);

  // Demo drafts stay browser-local. Authenticated production drafts are saved to PostgreSQL.
  useEffect(()=>{
    if(!ready)return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      if(demo) {
        setDrafts(previous=>{
          const next=[draft,...previous.filter(item=>item.id!==draft.id)].slice(0,20);
          try{localStorage.setItem(storageKey,JSON.stringify(next));setSaved(true);}
          catch{setNotice('Browser demo storage is unavailable. Use Print / Save PDF.');}
          return next;
        });
      } else {
        void requestJson('/api/v1/resume-drafts',{method:'PUT',body:JSON.stringify(draft)})
          .then(()=>{if(!cancelled){setDrafts(previous=>[draft,...previous.filter(item=>item.id!==draft.id)].slice(0,20));setSaved(true);}})
          .catch(error=>{if(!cancelled){setSaved(false);setNotice(error instanceof Error?error.message:'Cloud draft save failed.');}});
      }
    },650);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[draft,ready,storageKey,demo]);

  function change<K extends keyof ResumeDraft>(key:K,value:ResumeDraft[K]){
    setDraft(previous=>({...previous,[key]:value,updatedAt:new Date().toISOString()}));
    setSaved(false);setAiSuggestion(null);
  }
  function updateExperience(id:string,field:keyof ResumeExperience,value:string){
    change('experience',draft.experience.map(row=>row.id===id?{...row,[field]:value}:row));
  }
  function updateEducation(id:string,field:keyof ResumeEducation,value:string){
    change('education',draft.education.map(row=>row.id===id?{...row,[field]:value}:row));
  }
  function updateProject(id:string,field:keyof ResumeProject,value:string){
    change('projects',draft.projects.map(row=>row.id===id?{...row,[field]:value}:row));
  }
  function saveNow(nextDraft=draft){
    const next=[nextDraft,...drafts.filter(item=>item.id!==nextDraft.id)].slice(0,20);
    if(demo){
      try{localStorage.setItem(storageKey,JSON.stringify(next));setSaved(true);setNotice('Draft saved in this browser.');}
      catch{setNotice('Browser storage is unavailable. Use Print / Save PDF to keep a copy.');}
    } else {
      setSaved(false);
      void requestJson('/api/v1/resume-drafts',{method:'PUT',body:JSON.stringify(nextDraft)})
        .then(()=>{setSaved(true);setNotice('Resume saved to secure cloud database.');})
        .catch(error=>{setNotice(error instanceof Error?error.message:'Cloud draft save failed.');});
    }
    setDrafts(next);
  }
  function selectDraft(id:string){
    if(id===draft.id)return;
    saveNow();const chosen=drafts.find(item=>item.id===id);
    if(chosen){setDraft(chosen);setTab('personal');setAiSuggestion(null);setNotice('');}
  }
  function newDraft(){
    saveNow();const fresh=createResumeDraft();setDrafts(previous=>[fresh,...previous].slice(0,20));
    setDraft(fresh);setTab('personal');setNotice('New resume draft ready.');
  }
  async function deleteDraft(){
    if(!window.confirm('Delete this saved resume draft? This cannot be undone.'))return;
    if(!demo){
      try{await requestJson(`/api/v1/resume-drafts?id=${encodeURIComponent(draft.id)}`,{method:'DELETE'});}
      catch(error){setNotice(error instanceof Error?error.message:'Cloud draft deletion failed.');return;}
    }
    const remaining=drafts.filter(item=>item.id!==draft.id);
    const next=remaining[0]||createResumeDraft();
    const nextList=remaining.length?remaining:[next];
    setDrafts(nextList);setDraft(next);setTab('personal');
    setNotice(demo?'Draft removed from this browser.':'Draft deleted from cloud database.');
    if(demo)try{localStorage.setItem(storageKey,JSON.stringify(nextList));}catch{}
  }
  function importCandidate(){
    const source=candidates.find(item=>String(item.id)===candidateToImport);
    if(!source)return;
    if(draft.fullName.trim()&&draft.fullName!==source.full_name&&!window.confirm('Replace current contact and skills fields with the selected candidate?'))return;
    setDraft(previous=>({...previous,...candidateResumeFields(source),updatedAt:new Date().toISOString()}));
    setNotice('Candidate details imported. Review the fields before sharing.');setSaved(false);
  }
  async function enhanceWithAi(){
    if(demo){setAiError('Live AI rewriting is disabled in the isolated demo. Connect the secured backend and AI API key to enable it.');return;}
    if(!draft.fullName.trim()){setAiError('Enter the candidate name first.');return;}
    if(!draft.summary.trim()&&!draft.experience.some(row=>row.details.trim())){setAiError('Enter a summary or experience details for AI to improve.');return;}
    setAiBusy(true);setAiError('');setAiSuggestion(null);
    try {
      const response=await requestJson<{data:AiSuggestion}>('/api/v1/ai/resume',{method:'POST',body:JSON.stringify({
        fullName:draft.fullName,professionalTitle:draft.professionalTitle,summary:draft.summary,skills:draft.skills,
        experience:draft.experience,targetJobDescription:draft.targetJobDescription,
      })});
      setAiSuggestion(response.data);
    }catch(error){setAiError(error instanceof Error?error.message:'AI enhancement is unavailable. Your draft is safe.');}
    finally{setAiBusy(false);}
  }
  function applyAi(){
    if(!aiSuggestion)return;
    const enhanced=new Map(aiSuggestion.experience.map(row=>[row.id,row.bullets.join('\n')]));
    setDraft(previous=>({...previous,summary:aiSuggestion.summary||previous.summary,
      experience:previous.experience.map(row=>enhanced.has(row.id)?{...row,details:enhanced.get(row.id)||row.details}:row),updatedAt:new Date().toISOString()}));
    setAiSuggestion(null);setNotice('AI suggestions applied. Please verify every statement for accuracy before sharing.');setSaved(false);
  }

  const selectedName=draft.fullName.trim()||'Untitled resume';

  return <div className="page-shell resume-builder-page">
    <div className="page-heading"><div><p className="eyebrow">SKILLMINT / RECRUITMENT STUDIO</p><h1><Sparkles size={28}/> AI Resume Builder</h1><p>Create a polished, ATS-friendly resume from scratch or start with an existing candidate.</p></div>
      <div className="heading-actions"><button className="btn ghost" type="button" onClick={()=>saveNow()}><Save size={16}/>{saved?'Saved':'Save Draft'}</button><button className="btn primary" type="button" onClick={()=>window.print()}><Download size={16}/> Print / Save PDF</button></div></div>
    <div className="resume-builder-status"><span><Check size={15}/>{demo?'Browser-local demo drafts':'Private cloud-backed drafts'}</span><span>AI improvements require a configured, authenticated AI service.</span></div>
    <div className="resume-builder-toolbar panel">
      <label><span>My Resume Drafts</span><div className="resume-builder-select"><FileText size={18}/><select aria-label="Saved resume drafts" value={draft.id} onChange={event=>selectDraft(event.target.value)}>{drafts.map(item=><option key={item.id} value={item.id}>{item.fullName.trim()||'Untitled Resume'} · {new Date(item.updatedAt).toLocaleDateString('en-IN')}</option>)}</select><ChevronDown size={15}/></div></label>
      <div className="resume-builder-toolbar-actions"><button className="btn ghost" onClick={newDraft} type="button"><FilePlus2 size={16}/> New Resume</button><button className="btn ghost resume-delete-draft" onClick={deleteDraft} type="button" aria-label="Delete current resume draft"><Trash2 size={16}/></button></div>
      <label className="resume-candidate-import"><span>Import from Lead Bank</span><div className="resume-candidate-import-controls"><select className="form-input" aria-label="Choose candidate to import" value={candidateToImport} onChange={event=>setCandidateToImport(event.target.value)}><option value="">Select candidate (optional)</option>{candidates.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.full_name||'Candidate')}{item.email?` · ${item.email}`:''}</option>)}</select><button className="btn soft" type="button" disabled={!candidateToImport} onClick={importCandidate}><UserRoundSearch size={16}/> Import</button></div></label>
    </div>
    {notice&&<div className="alert resume-builder-notice" role="status">{notice}</div>}
    <div className="resume-builder-layout">
      <section className="resume-editor panel" aria-label="Resume details editor">
        <div className="resume-editor-heading"><div><span className="eyebrow">BUILD YOUR RESUME</span><h2>{selectedName}</h2><p>Complete the sections below. Your preview updates instantly.</p></div><span className="resume-editor-step">{tabs.findIndex(item=>item.id===tab)+1} / 4</span></div>
        <div className="resume-editor-tabs" role="tablist" aria-label="Resume editor sections">{tabs.map(item=><button key={item.id} type="button" role="tab" aria-selected={tab===item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div>
        <div className="resume-editor-body">
          {tab==='personal'&&<div className="resume-editor-group">
            <h3>Personal Information</h3><div className="resume-editor-grid">
              <Field label="Full Name *" value={draft.fullName} onChange={v=>change('fullName',v)} placeholder="e.g. Priya Sharma"/>
              <Field label="Professional Title" value={draft.professionalTitle} onChange={v=>change('professionalTitle',v)} placeholder="e.g. Senior Frontend Developer"/>
              <Field label="Email" value={draft.email} onChange={v=>change('email',v)} type="email" placeholder="name@example.com"/>
              <Field label="Phone" value={draft.phone} onChange={v=>change('phone',v)} type="tel" placeholder="+91 ..."/>
              <Field label="Current Location" value={draft.location} onChange={v=>change('location',v)} placeholder="City, Country"/>
              <Field label="LinkedIn" value={draft.linkedin} onChange={v=>change('linkedin',v)} placeholder="linkedin.com/in/your-name"/>
              <Field label="Portfolio / Website" value={draft.portfolio} onChange={v=>change('portfolio',v)} placeholder="yourportfolio.com"/>
            </div>
            <h3>Profile & Skills</h3>
            <Multi label="Professional Summary" value={draft.summary} onChange={v=>change('summary',v)} rows={5} placeholder="Describe your professional background, strengths and career focus. Keep the claims factual."/>
            <Multi label="Key Skills" value={draft.skills} onChange={v=>change('skills',v)} hint="Separate skills with commas or new lines." rows={3} placeholder="Recruitment, Candidate Screening, Excel, React..."/>
            <button className="resume-starter-button" type="button" disabled={!starterResumeSummary(draft)} onClick={()=>{if(draft.summary.trim()&&!window.confirm('Replace your current summary with a starter template?'))return;change('summary',starterResumeSummary(draft));}}><FileText size={16}/> Use a factual starter summary <small>(offline template, not AI)</small></button>
          </div>}
          {tab==='experience'&&<div className="resume-editor-group"><div className="resume-editor-group-head"><div><h3>Work Experience</h3><p>Add roles in reverse-chronological order.</p></div><button className="btn soft" type="button" onClick={()=>change('experience',[...draft.experience,{id:crypto.randomUUID(),role:'',company:'',period:'',details:''}])}><Plus size={16}/> Add Role</button></div>
            {!draft.experience.length&&<div className="resume-editor-empty">No roles added yet. Use “Add Role” to describe your experience.</div>}
            {draft.experience.map((row,index)=><div className="resume-editor-entry" key={row.id}><div className="resume-editor-entry-heading"><strong>Experience {index+1}</strong><button type="button" onClick={()=>change('experience',draft.experience.filter(item=>item.id!==row.id))} aria-label={`Remove experience ${index+1}`}><Trash2 size={16}/></button></div>
              <div className="resume-editor-grid"><Field label="Job Title" value={row.role} onChange={v=>updateExperience(row.id,'role',v)} placeholder="e.g. Recruitment Specialist"/><Field label="Company" value={row.company} onChange={v=>updateExperience(row.id,'company',v)} placeholder="Company name"/><Field label="Duration" value={row.period} onChange={v=>updateExperience(row.id,'period',v)} placeholder="Jan 2023 – Present"/></div>
              <Multi label="Responsibilities & Achievements" value={row.details} onChange={v=>updateExperience(row.id,'details',v)} rows={5} hint="One achievement or responsibility per line. Use actual results only." placeholder="Managed recruitment operations for ...\nCoordinated interviews with ..."/>
            </div>)}
          </div>}
          {tab==='education'&&<div className="resume-editor-group">
            <div className="resume-editor-group-head"><h3>Education</h3><button type="button" className="btn soft" onClick={()=>change('education',[...draft.education,{id:crypto.randomUUID(),degree:'',institution:'',year:''}])}><Plus size={16}/> Add Education</button></div>
            {draft.education.map((row,index)=><div className="resume-editor-entry" key={row.id}><div className="resume-editor-entry-heading"><strong>Education {index+1}</strong><button type="button" aria-label={`Remove education ${index+1}`} onClick={()=>change('education',draft.education.filter(item=>item.id!==row.id))}><Trash2 size={16}/></button></div><div className="resume-editor-grid"><Field label="Degree / Qualification" value={row.degree} onChange={v=>updateEducation(row.id,'degree',v)}/><Field label="University / Institution" value={row.institution} onChange={v=>updateEducation(row.id,'institution',v)}/><Field label="Graduation Year" value={row.year} onChange={v=>updateEducation(row.id,'year',v)}/></div></div>)}
            <div className="resume-editor-group-head"><h3>Projects</h3><button type="button" className="btn soft" onClick={()=>change('projects',[...draft.projects,{id:crypto.randomUUID(),name:'',details:''}])}><Plus size={16}/> Add Project</button></div>
            {draft.projects.map((row,index)=><div className="resume-editor-entry" key={row.id}><div className="resume-editor-entry-heading"><strong>Project {index+1}</strong><button type="button" aria-label={`Remove project ${index+1}`} onClick={()=>change('projects',draft.projects.filter(item=>item.id!==row.id))}><Trash2 size={16}/></button></div><Field label="Project Name" value={row.name} onChange={v=>updateProject(row.id,'name',v)}/><Multi label="Project Details" value={row.details} onChange={v=>updateProject(row.id,'details',v)} rows={3}/></div>)}
            <Multi label="Certifications" value={draft.certifications} onChange={v=>change('certifications',v)} hint="One certification per line." placeholder="AWS Cloud Practitioner\nGoogle Analytics..." rows={3}/>
          </div>}
          {tab==='ai'&&<div className="resume-editor-group resume-ai-tools"><span className="resume-ai-icon"><WandSparkles size={24}/></span><h3>AI-Powered Resume Enhancement</h3><p>Make your resume clearer and more relevant to a job description. Clicking Improve with AI sends the entered resume details and job description to the configured AI service. Only facts you provide should be used; review every suggestion.</p>
            <Multi label="Target Job Description (Optional)" value={draft.targetJobDescription} onChange={v=>change('targetJobDescription',v)} rows={8} hint="Paste the job description to guide wording and ATS keywords. This is not included in the final resume." placeholder="Paste the job description here…"/>
            <button className="btn primary" type="button" disabled={demo||aiBusy} onClick={()=>void enhanceWithAi()}>{aiBusy?<Loader2 size={17} className="resume-spin"/>:<Sparkles size={17}/>} {aiBusy?'Generating suggestions…':'Improve with AI'}</button>
            {demo&&<div className="resume-ai-info">AI requests are disabled in the public demo. The resume editor, local draft saving, preview, and PDF export remain available. Activate a secured CRM backend and configure the AI API key for live rewriting.</div>}
            {aiError&&<div className="alert danger" role="alert">{aiError}</div>}
            {aiSuggestion&&<div className="resume-ai-suggestions"><h4>Review AI Suggestions</h4><p><b>Suggested Summary</b></p><div>{aiSuggestion.summary}</div>{aiSuggestion.experience.map(row=><div key={row.id}><b>{draft.experience.find(item=>item.id===row.id)?.role||'Experience'}:</b><ul>{row.bullets.map((bullet,i)=><li key={i}>{bullet}</li>)}</ul></div>)}<div className="resume-ai-actions"><button className="btn primary" type="button" onClick={applyAi}><Check size={16}/> Apply Suggestions</button><button className="btn ghost" type="button" onClick={()=>setAiSuggestion(null)}>Discard</button></div></div>}
            <Link className="resume-ai-back-link" href="/candidates"><ArrowLeft size={16}/> Back to Lead Bank</Link>
          </div>}
        </div>
        <div className="resume-editor-bottom"><button className="btn ghost" type="button" disabled={tab==='personal'} onClick={()=>setTab(tabs[Math.max(0,tabs.findIndex(item=>item.id===tab)-1)].id)}>Previous</button><button className="btn primary" type="button" onClick={()=>{const index=tabs.findIndex(item=>item.id===tab);if(index<tabs.length-1)setTab(tabs[index+1].id);else saveNow();}}>{tab==='ai'?'Save Resume Draft':'Continue'} {tab==='ai'?<Save size={16}/>:<ChevronDown className="resume-next-icon" size={16}/>}</button></div>
      </section>
      <div className="resume-preview-column"><div className="resume-preview-heading"><div><span className="eyebrow">LIVE A4 PREVIEW</span><h2>Resume Preview</h2><p>Ready for printing or saving as PDF.</p></div><label><span>Template</span><select className="form-input" aria-label="Resume template" value={draft.template} onChange={event=>change('template',event.target.value as ResumeDraft['template'])}><option value="executive">Executive Blue</option><option value="minimal">Minimal White</option></select></label></div><ResumePreview draft={draft}/><p className="resume-preview-footnote">Use <b>Print / Save PDF</b>, then choose <b>Save as PDF</b> in your browser. Always review candidate information before sharing.</p></div>
    </div>
  </div>;
}
