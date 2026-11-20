'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { parseResume } from '@/lib/resume-fields';
import { readBrowserResume } from '@/lib/browser-resume';
import { findDemoDuplicate, isDemoClient } from '@/lib/demo-client';

export type Row=Record<string,unknown>;
export type Duplicate={kind?:string;message?:string;existing_candidate_id?:string|null;existing_candidate_name?:string|null};
export type Extraction={file:File;parsed:Row;sha256:string;duplicate:Duplicate|null;detailsOnly?:boolean};

const ACCEPT='.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Validates the file, extracts text/fields server-side and checks duplicates; creates nothing. */
export function ResumeDropzone({onExtracted}:{onExtracted:(result:Extraction)=>void}) {
  const input=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[drag,setDrag]=useState(false),[blocked,setBlocked]=useState<Duplicate|null>(null);
  const [saveOriginal,setSaveOriginal]=useState(process.env.NODE_ENV!=='production');
  async function handle(file:File|null) {
    if(!file)return;
    setError('');setBlocked(null);
    if(!/\.(pdf|docx)$/i.test(file.name)){setError('Only PDF and DOCX resumes are accepted.');return;}
    const max=isDemoClient()||process.env.NODE_ENV!=='production'?10:4;
    if(file.size>max*1024*1024){setError('Resume must be '+max+' MB or smaller.');return;}
    setBusy(true);
    try {
      const form=new FormData();form.set('file',file);
      if(isDemoClient()) {
        const response=await fetch('/api/dev/parse-resume',{method:'POST',body:form});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Unable to extract resume text');
        onExtracted({file,parsed:data.parsed,sha256:String(data.sha256),duplicate:findDemoDuplicate(data.parsed,String(data.sha256))});
      } else if(!saveOriginal) {
        const {text,sha256}=await readBrowserResume(file);
        if(text.trim().length<40)throw new Error('No readable text detected. Use a text-based resume or Manual Entry; scanned images need OCR.');
        onExtracted({file,parsed:{...parseResume(text,file.name)},sha256,duplicate:null,detailsOnly:true});
      } else {
        form.set('preview','1');
        const response=await fetch('/api/v1/resumes',{method:'POST',body:form});
        const data=await response.json();
        if(response.status===409){setBlocked(data);return;}
        if(!response.ok)throw new Error(data.error||'Unable to extract resume text');
        onExtracted({file,parsed:data.parsed,sha256:String(data.sha256),duplicate:data.duplicate});
      }
    } catch(err){setError(err instanceof Error?err.message:'Resume extraction failed');}
    finally{setBusy(false);if(input.current)input.current.value='';}
  }
  return <div>
    {!isDemoClient()&&<label style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}><input type="checkbox" checked={saveOriginal} disabled={busy} onChange={e=>setSaveOriginal(e.target.checked)}/> Scan and save original file (requires configured antivirus)</label>}
    {!isDemoClient()&&!saveOriginal&&<p className="muted">Details-only mode: the file is read in this browser. Only reviewed candidate fields are saved; the original document is not uploaded.</p>}
    <div className={`dropzone ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);void handle(e.dataTransfer.files[0]||null);}}>
      <span className="upload-cloud"><UploadCloud size={28}/></span>
      <h3>{busy?'Reading resume…':'Drop a candidate resume here'}</h3>
      <p>PDF or DOCX · Up to {isDemoClient()||process.env.NODE_ENV!=='production'?10:4} MB · Details are extracted for your review before anything is saved.</p>
      <input ref={input} type="file" accept={ACCEPT} onChange={e=>void handle(e.target.files?.[0]||null)} hidden/>
      <button type="button" className="btn primary" disabled={busy} onClick={()=>input.current?.click()}>Browse Files</button>
    </div>
    {error&&<div className="alert danger">{error}</div>}
    {blocked&&<div className="alert danger">{blocked.message||'This exact resume is already uploaded.'}{blocked.existing_candidate_name?` Existing candidate: ${blocked.existing_candidate_name}.`:''}</div>}
  </div>;
}
