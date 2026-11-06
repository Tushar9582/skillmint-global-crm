'use client';

import { demoHrRequest } from './hr/demo-all';
import { demoValidateCrm } from './hr/demo-config';

/** Browser-only CRM simulation. It is intentionally isolated from API/database data. */
type Row=Record<string,unknown>;
const KEY='skillmint-development-demo-v1';
const enabled=()=>process.env.NODE_ENV==='development'&&process.env.NEXT_PUBLIC_DEV_DEMO_MODE==='true';
const admin={id:'00000000-0000-4000-8000-000000000001',full_name:'SkillMint Development Admin',email:'development-admin@skillmint.local',role:'admin',active:true};
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
function seed():Record<string,Row[]> {
  const company={id:id(),company_name:'AsterByte Technologies',contact_name:'Priya Nair',email:'priya@asterbyte.example',phone:'9876543210',industry:'Software',city:'Bengaluru',stage:'qualified',priority:'high',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const candidate={id:id(),full_name:'Aarav Sharma',email:'aarav.sharma@example.com',phone:'9988776655',location:'Bengaluru',skills:['TypeScript','React','PostgreSQL'],experience_years:4,preferred_role:'Frontend Engineer',source:'resume',stage:'screened',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const client={id:id(),company_name:'Northstar Retail',contact_name:'Meera Shah',contact_email:'meera@northstar.example',city:'Mumbai',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const job={id:id(),client_id:client.id,client_name:client.company_name,title:'Senior React Developer',location:'Bengaluru',openings:2,stage:'open',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  return {'company-leads':[company],candidates:[candidate],clients:[client],jobs:[job],applications:[],interviews:[],followups:[{id:id(),title:'Follow up with AsterByte',target_type:'company_leads',target_id:company.id,due_at:new Date(Date.now()+86400000).toISOString(),priority:'high',status:'pending',owner_id:admin.id,owner_name:admin.full_name,created_at:now()}],employees:[admin],activities:[],'daily-reports':[],notifications:[],resumes:[]};
}
function store(){if(typeof window==='undefined')return seed();try{const raw=localStorage.getItem(KEY);if(raw)return JSON.parse(raw) as Record<string,Row[]>;}catch{}const data=seed();save(data);return data;}
function save(data:Record<string,Row[]>){localStorage.setItem(KEY,JSON.stringify(data));}
function resource(url:string){return url.split('?')[0].replace('/api/v1/','').split('/');}
function dashboard(data:Record<string,Row[]>){const pending=data.followups.filter(x=>x.status!=='completed');return {company_leads:data['company-leads'].length,candidates:data.candidates.length,jobs:data.jobs.length,applications:data.applications.length,interviews_today:0,followups_due:pending.length,overdue:0,placements:0,queue:pending,latest:data.activities,exceptions:{duplicate_reviews:0,unassigned_leads:0}};}
const indiaDate=(value:unknown)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(value)));
function dailyStats(data:Record<string,Row[]>,date:string,userId=admin.id){const activities=(data.activities||[]).filter(row=>row.actor_id===userId&&indiaDate(row.created_at)===date);return {activities:activities.length,calls:activities.filter(row=>row.channel==='call').length,followups:(data.followups||[]).filter(row=>row.completed_by===userId&&row.completed_at&&indiaDate(row.completed_at)===date).length,interviews:(data.interviews||[]).filter(row=>row.owner_id===userId&&row.scheduled_at&&String(row.scheduled_at).slice(0,10)===date).length};}
export function isDemoClient(){return enabled();}
export async function demoRequest<T>(url:string,init?:RequestInit):Promise<T> {
  if(/^\/api\/v1\/(hr|payroll|finance|config)\//.test(url))return demoHrRequest<T>(url,init);
  const data=store();const method=(init?.method||'GET').toUpperCase();const [base,recordId,action]=resource(url);const payload=typeof init?.body==='string'?JSON.parse(init.body):{};
  if(base==='dashboard')return {data:dashboard(data)} as T;
  if(base==='employees'&&recordId==='detail') return {data:{employee:admin}} as T;
  if(base==='employees'&&!recordId){if(method==='POST'){const r={...payload,id:id(),owner_name:payload.full_name||'Demo Employee',created_at:now()};data.employees.push(r);save(data);return {data:r} as T;}return {data:data.employees} as T;}
  if(base==='duplicates')return {data:[]} as T;
  if(base==='daily-report'){
    const date=new URLSearchParams(url.split('?')[1]||'').get('date')||indiaDate(now());const reports=data['daily-reports']||(data['daily-reports']=[]);
    if(method==='GET')return {data:{date,stats:dailyStats(data,date),report:reports.find(row=>row.user_id===admin.id&&row.report_date===date)||null}} as T;
    const index=reports.findIndex(row=>row.user_id===admin.id&&row.report_date===String(payload.date||date));const report={id:index>=0?reports[index].id:id(),user_id:admin.id,report_date:String(payload.date||date),blockers:String(payload.blockers||''),tomorrow_plan:String(payload.tomorrow_plan||''),submitted_at:now()};if(index>=0)reports[index]=report;else reports.unshift(report);save(data);return {data:{report,stats:dailyStats(data,report.report_date)}} as T;
  }
  if(base==='activities'){
    if(method==='GET')return {data:data.activities||[]} as T;
    const activity={...payload,id:id(),actor_id:admin.id,employee_name:admin.full_name,created_at:now()};(data.activities||=[]).unshift(activity);save(data);return {data:activity} as T;
  }
  if(['reports','audit','notifications','handover','imports'].includes(base))return {data:base==='reports'?{metrics:{}}:data[base]||[],stats:{}} as T;
  if(base==='resumes'){const cid=new URLSearchParams(url.split('?')[1]||'').get('candidate_id');return {data:(data.resumes||[]).filter(r=>!cid||r.candidate_id===cid)} as T;}
  if(base==='assignments' || base==='export')return {ok:true,data:{}} as T;
  const rows=data[base]||(data[base]=[]);
  if(method==='GET'){if(recordId)return {data:rows.find(x=>x.id===recordId)} as T;return {data:rows,has_more:false} as T;}
  if(method==='POST'&&action==='complete'){const row=rows.find(x=>x.id===recordId);if(row)Object.assign(row,{status:'completed',completed_by:admin.id,completed_at:now()});save(data);return {ok:true,data:row} as T;}
  if(method==='DELETE'){
    if(!['company-leads','candidates'].includes(base))throw new Error('Only company and candidate leads can be deleted.');
    const index=rows.findIndex(x=>x.id===recordId);if(index<0)throw new Error('Lead not found.');
    rows.splice(index,1);
    if(base==='candidates'){const removed=(data.resumes||[]).filter(r=>r.candidate_id===recordId).map(r=>r.id);data.resumes=(data.resumes||[]).filter(r=>r.candidate_id!==recordId);data.followups=(data.followups||[]).filter(r=>r.target_id!==recordId);data.activities=(data.activities||[]).filter(r=>r.target_id!==recordId);void removed;}
    if(base==='company-leads')data.followups=(data.followups||[]).filter(r=>r.target_id!==recordId);
    save(data);return {ok:true,message:'Lead deleted successfully.'} as T;
  }
  if(method==='POST'){demoValidateCrm(base,payload,null);const duplicate=base==='candidates'&&rows.some(x=>(payload.email&&x.email===payload.email)||(payload.phone&&x.phone===payload.phone));if(duplicate)throw new Error('Candidate with this email or phone may already exist. Demo review required.');const r={...payload,id:id(),owner_id:payload.owner_id||admin.id,owner_name:admin.full_name,created_at:now()};rows.unshift(r);save(data);return {data:r} as T;}
  const row=rows.find(x=>x.id===recordId);if(!row)throw new Error('Record not found');demoValidateCrm(base,payload,row);Object.assign(row,payload,{updated_at:now()});save(data);return {data:row} as T;
}
export function findDemoDuplicate(values:Row,sha256:string){
  const data=store();
  const email=String(values.email||'').trim().toLowerCase();const phone=String(values.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
  const exact=(data.resumes||[]).find(r=>r.sha256===sha256);
  const identity=data.candidates.find(r=>(email&&String(r.email||'').toLowerCase()===email)||(phone&&String(r.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'')===phone));
  if(!exact&&!identity)return null;
  const match=exact?data.candidates.find(r=>r.id===exact.candidate_id):identity;
  return {duplicate:true,kind:exact?'exact':'identity',existing_candidate_id:match?String(match.id):null,existing_candidate_name:match?String(match.full_name):null,message:exact?'This exact resume has already been uploaded.':'A candidate with this email or phone already exists. Attach the resume to the existing candidate instead of creating a duplicate.'};
}
export function saveDemoResumeCandidate(values:Row,file:{name:string;sha256:string},ownerId:string){
  const data=store();
  const dup=findDemoDuplicate(values,file.sha256);
  if(dup) return dup;
  const candidate={...values,id:id(),source:'resume',stage:String(values.stage||'new'),owner_id:ownerId||admin.id,owner_name:admin.full_name,created_at:now(),notes:[String(values.notes||''),'Development demo: parsed locally; resume file was not uploaded to cloud storage.'].filter(Boolean).join('\n')};
  data.candidates.unshift(candidate);const version={id:id(),candidate_id:candidate.id,original_filename:file.name,sha256:file.sha256,storage_key:'demo-browser-only',created_at:now()};(data.resumes||=[]).unshift(version);save(data);
  return {created:true,message:'Candidate lead created from locally extracted resume details. The resume file was not saved to cloud storage.',data:{candidate_id:String(candidate.id),resume_version_id:String(version.id)}};
}
export function attachDemoResume(candidateId:string,file:{name:string;sha256:string}){
  const data=store();
  if(!data.candidates.some(r=>r.id===candidateId))throw new Error('Candidate not found.');
  if((data.resumes||[]).some(r=>r.sha256===file.sha256))throw new Error('This exact resume has already been uploaded.');
  const version={id:id(),candidate_id:candidateId,original_filename:file.name,sha256:file.sha256,storage_key:'demo-browser-only',created_at:now()};
  (data.resumes||=[]).unshift(version);save(data);
  return {created:true,message:'Resume version attached to the existing candidate. No duplicate candidate was created.',data:{candidate_id:candidateId,resume_version_id:String(version.id)}};
}
