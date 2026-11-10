'use client';

import { demoHrRequest } from './hr/demo-all';
import { demoValidateCrm } from './hr/demo-config';
import { removeDemoResumeFiles, saveDemoResumeFile } from './demo-resume-storage';
import { emptyRecruiterProgress, isLeadResource, parseAssignmentRange, parseProgressPeriod } from './lead-operations';

/** Browser-only CRM simulation. It is intentionally isolated from API/database data. */
type Row=Record<string,unknown>;
const KEY='skillmint-development-demo-v1';
const enabled=()=>process.env.NODE_ENV==='development'&&process.env.NEXT_PUBLIC_DEV_DEMO_MODE==='true'
  ||process.env.NODE_ENV==='production'&&process.env.NEXT_PUBLIC_DEMO_MODE==='true';
const admin={id:'00000000-0000-4000-8000-000000000001',full_name:'SkillMint Development Admin',email:'development-admin@skillmint.local',role:'admin',active:true};
const demoRecruiters=[
  {id:'00000000-0000-4000-8000-000000000002',full_name:'Demo Recruiter A',email:'recruiter-a@demo.skillmint.local',role:'employee',team:'Recruitment',active:true},
  {id:'00000000-0000-4000-8000-000000000003',full_name:'Demo Recruiter B',email:'recruiter-b@demo.skillmint.local',role:'employee',team:'Recruitment',active:true},
];
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
function seed():Record<string,Row[]> {
  const company={id:id(),company_name:'AsterByte Technologies',contact_name:'Priya Nair',email:'priya@asterbyte.example',phone:'9876543210',industry:'Software',city:'Bengaluru',stage:'qualified',priority:'high',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const candidate={id:id(),full_name:'Aarav Sharma',email:'aarav.sharma@example.com',phone:'9988776655',location:'Bengaluru',skills:['TypeScript','React','PostgreSQL'],experience_years:4,preferred_role:'Frontend Engineer',source:'resume',stage:'screened',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const client={id:id(),company_name:'Northstar Retail',contact_name:'Meera Shah',contact_email:'meera@northstar.example',city:'Mumbai',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  const job={id:id(),client_id:client.id,client_name:client.company_name,title:'Senior React Developer',location:'Bengaluru',openings:2,stage:'open',owner_id:admin.id,owner_name:admin.full_name,created_at:now()};
  return {'company-leads':[company],candidates:[candidate],clients:[client],jobs:[job],applications:[],interviews:[],followups:[{id:id(),title:'Follow up with AsterByte',target_type:'company_leads',target_id:company.id,due_at:new Date(Date.now()+86400000).toISOString(),priority:'high',status:'pending',owner_id:admin.id,owner_name:admin.full_name,created_at:now()}],employees:[admin,...demoRecruiters],activities:[],'stage-history':[],'assignment-history':[],'daily-reports':[],notifications:[],resumes:[]};
}
function store(){if(typeof window==='undefined')return seed();try{const raw=localStorage.getItem(KEY);if(raw){
  const existing=JSON.parse(raw) as Record<string,Row[]>;
  const employees=existing.employees||(existing.employees=[]);
  const missing=demoRecruiters.filter(person=>!employees.some(employee=>employee.id===person.id));
  if(missing.length){employees.push(...missing);save(existing);}
  return existing;
}}catch{}const data=seed();save(data);return data;}
function save(data:Record<string,Row[]>){localStorage.setItem(KEY,JSON.stringify(data));}
function resource(url:string){return url.split('?')[0].replace('/api/v1/','').split('/');}
function dashboard(data:Record<string,Row[]>){const pending=data.followups.filter(x=>x.status==='pending');return {company_leads:data['company-leads'].length,candidates:data.candidates.length,jobs:data.jobs.length,applications:data.applications.length,interviews_today:0,followups_due:pending.length,overdue:0,placements:0,queue:pending,latest:data.activities,exceptions:{duplicate_reviews:0,unassigned_leads:data['company-leads'].filter(row=>!row.owner_id).length}};}
const indiaDate=(value:unknown)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(value)));
function dailyStats(data:Record<string,Row[]>,date:string,userId=admin.id){const activities=(data.activities||[]).filter(row=>row.actor_id===userId&&indiaDate(row.created_at)===date);return {activities:activities.length,calls:activities.filter(row=>row.channel==='call').length,followups:(data.followups||[]).filter(row=>row.completed_by===userId&&row.completed_at&&indiaDate(row.completed_at)===date).length,interviews:(data.interviews||[]).filter(row=>row.owner_id===userId&&row.scheduled_at&&String(row.scheduled_at).slice(0,10)===date).length};}

function listMatch(rows:Row[],search:string,stage:string){
  const query=search.trim().toLowerCase();
  return rows.filter(row=>(!stage||row.stage===stage)&&(!query||JSON.stringify(row).toLowerCase().includes(query)))
    .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.id).localeCompare(String(a.id)));
}
function personName(data:Record<string,Row[]>,userId:unknown){return String(data.employees.find(person=>person.id===userId)?.full_name||'Unassigned');}
function demoProgress(data:Record<string,Row[]>,from:string,to:string){
  const period=parseProgressPeriod(from,to);
  const within=(value:unknown)=>{const at=new Date(String(value||'')).getTime();return at>=Date.parse(period.startIso)&&at<Date.parse(period.endExclusiveIso);};
  const employees=data.employees.map(person=>emptyRecruiterProgress({id:String(person.id),full_name:String(person.full_name),team:person.team,active:person.active}));
  for(const person of employees){
    const owned=(resource:string)=>(data[resource]||[]).filter(row=>row.owner_id===person.id).length;
    person.company_leads=owned('company-leads');person.candidates=owned('candidates');person.applications=owned('applications');
    const acts=(data.activities||[]).filter(row=>row.actor_id===person.id&&within(row.created_at));
    person.activities=acts.length;person.calls=acts.filter(row=>row.channel==='call').length;person.meetings=acts.filter(row=>row.channel==='meeting').length;
    person.last_activity_at=acts.length?String(acts[0].created_at):null;
    person.stage_updates=(data['stage-history']||[]).filter(row=>row.changed_by===person.id&&
      ['company_leads','candidates','applications'].includes(String(row.entity_type))&&within(row.created_at)).length;
    person.followups_done=(data.followups||[]).filter(row=>row.completed_by===person.id&&row.status==='done'&&within(row.completed_at)).length;
    person.pending_followups=(data.followups||[]).filter(row=>row.owner_id===person.id&&row.status==='pending').length;
    person.interviews_scheduled=(data.interviews||[]).filter(row=>row.owner_id===person.id&&within(row.scheduled_at)).length;
  }
  employees.sort((a,b)=>Number(b.active)-Number(a.active)||
    b.company_leads+b.candidates+b.applications-(a.company_leads+a.candidates+a.applications)||a.full_name.localeCompare(b.full_name));
  const summary=employees.reduce((total,person)=>({assigned:total.assigned+person.company_leads+person.candidates+person.applications,
    activities:total.activities+person.activities,meetings:total.meetings+person.meetings+person.interviews_scheduled,
    followups:total.followups+person.followups_done}),{assigned:0,activities:0,meetings:0,followups:0});
  return {period:{from,to},summary,employees};
}
function demoLeadTimeline(data:Record<string,Row[]>,resource:string,recordId:string){
  const kind=resource.replace(/-/g,'_');
  if(!isLeadResource(resource)||!(data[resource]||[]).some(row=>row.id===recordId))throw new Error('Lead not found');
  const stages=(data['stage-history']||[]).filter(row=>row.entity_type===kind&&row.entity_id===recordId)
    .map((row):Row=>({...row,changed_by_name:personName(data,row.changed_by)})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const assignments=(data['assignment-history']||[]).filter(row=>row.entity_type===kind&&row.entity_id===recordId)
    .map((row):Row=>({...row,from_name:row.from_owner?personName(data,row.from_owner):null,to_name:personName(data,row.to_owner)}))
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const followups=(data.followups||[]).filter(row=>row.target_type===kind&&row.target_id===recordId)
    .map((row):Row=>({...row,owner_name:personName(data,row.owner_id)}))
    .sort((a,b)=>Number(a.status!=='pending')-Number(b.status!=='pending')||String(a.due_at).localeCompare(String(b.due_at)));
  const relatedAppIds=resource==='candidates'?(data.applications||[]).filter(row=>row.candidate_id===recordId).map(row=>row.id):[];
  const interviews=(data.interviews||[]).filter(row=>resource==='applications'?row.application_id===recordId:
    resource==='candidates'&&relatedAppIds.includes(row.application_id)).sort((a,b)=>String(b.scheduled_at).localeCompare(String(a.scheduled_at)));
  return {stages,assignments,followups,interviews};
}
export function isDemoClient(){return enabled();}
export async function demoRequest<T>(url:string,init?:RequestInit):Promise<T> {
  if(/^\/api\/v1\/(hr|payroll|finance|config)\//.test(url))return demoHrRequest<T>(url,init);
  const data=store();const method=(init?.method||'GET').toUpperCase();const [base,recordId,action]=resource(url);const payload=typeof init?.body==='string'?JSON.parse(init.body):{};
  const query=new URLSearchParams(url.split('?')[1]||'');
  if(base==='dashboard')return {data:dashboard(data)} as T;
  if(base==='lead-progress'){
    const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
    return {data:demoProgress(data,query.get('from')||today,query.get('to')||today)} as T;
  }
  if(base==='lead-timeline')return {data:demoLeadTimeline(data,query.get('resource')||'',query.get('id')||'')} as T;
  if(base==='employees'&&recordId==='detail') return {data:{employee:admin}} as T;
  if(base==='employees'&&!recordId){if(method==='POST'){const r={...payload,id:id(),owner_name:payload.full_name||'Demo Employee',created_at:now()};data.employees.push(r);save(data);return {data:r} as T;}return {data:data.employees} as T;}
  if(base==='duplicates')return {data:[]} as T;
  if(base==='daily-report'){
    const date=new URLSearchParams(url.split('?')[1]||'').get('date')||indiaDate(now());const reports=data['daily-reports']||(data['daily-reports']=[]);
    if(method==='GET')return {data:{date,stats:dailyStats(data,date),report:reports.find(row=>row.user_id===admin.id&&row.report_date===date)||null}} as T;
    const index=reports.findIndex(row=>row.user_id===admin.id&&row.report_date===String(payload.date||date));const report={id:index>=0?reports[index].id:id(),user_id:admin.id,report_date:String(payload.date||date),blockers:String(payload.blockers||''),tomorrow_plan:String(payload.tomorrow_plan||''),submitted_at:now()};if(index>=0)reports[index]=report;else reports.unshift(report);save(data);return {data:{report,stats:dailyStats(data,report.report_date)}} as T;
  }
  if(base==='activities'){
    if(method==='GET')return {data:(data.activities||[]).filter(row=>(!query.has('target_type')||row.target_type===query.get('target_type'))&&
      (!query.has('target_id')||row.target_id===query.get('target_id')))} as T;
    const target=(data[String(payload.target_type||'').replace(/_/g,'-')]||[]).find(row=>row.id===payload.target_id);
    if(!target)throw new Error('Related lead was not found');
    if(payload.channel==='meeting'&&payload.outcome==='scheduled'&&!payload.next_due_at)throw new Error('Choose a meeting date and time');
    const activity={...payload,id:id(),actor_id:admin.id,employee_name:admin.full_name,created_at:now()};(data.activities||=[]).unshift(activity);
    if(payload.next_due_at)(data.followups||=[]).unshift({id:id(),target_type:payload.target_type,target_id:payload.target_id,
      owner_id:target.owner_id||admin.id,owner_name:personName(data,target.owner_id||admin.id),
      title:payload.channel==='meeting'?'Scheduled lead meeting':`Follow up: ${payload.outcome}`,
      channel:payload.channel,due_at:payload.next_due_at,status:'pending',priority:'medium',created_at:now()});
    save(data);return {data:activity} as T;
  }
  if(['reports','audit','notifications','handover','imports'].includes(base))return {data:base==='reports'?{metrics:{}}:data[base]||[],stats:{}} as T;
  if(base==='resumes'){const cid=new URLSearchParams(url.split('?')[1]||'').get('candidate_id');return {data:(data.resumes||[]).filter(r=>!cid||r.candidate_id===cid)} as T;}
  if(base==='assignments'){
    const resourceName=String(payload.resource||query.get('resource')||'');
    if(!isLeadResource(resourceName)&&!['clients','jobs','interviews'].includes(resourceName))throw new Error('Choose an assignable module');
    const matching=listMatch(data[resourceName]||[],String(query.get('q')||''),String(query.get('stage')||''));
    if(method==='GET')return {data:{total:matching.length}} as T;
    if(method!=='POST'||recordId!=='bulk')throw new Error('Unsupported assignment action');
    const person=data.employees.find(p=>p.id===payload.to_owner&&p.active!==false);
    if(!person)throw new Error('Select an active recruiter');
    const range=payload.range===undefined?null:parseAssignmentRange(payload.range);
    if(range&&payload.ids?.length)throw new Error('Choose selected rows or a range, not both');
    if(range&&!isLeadResource(resourceName))throw new Error('Range allocation is only for leads');
    const chosen=range?listMatch(data[resourceName]||[],range.search,range.stage).slice(range.from-1,range.to):
      (data[resourceName]||[]).filter(row=>Array.isArray(payload.ids)&&payload.ids.includes(row.id));
    const requested=range?range.to-range.from+1:Array.isArray(payload.ids)?payload.ids.length:0;
    if(!requested||requested>200||chosen.length!==requested||(!range&&new Set(payload.ids).size!==requested))
      throw new Error('Invalid selection or insufficient matching leads. Refresh the list.');
    let changed=0;
    for(const row of chosen){
      const previous=row.owner_id;
      if(previous===person.id)continue;
      changed++;
      row.owner_id=person.id;row.owner_name=person.full_name;row.updated_at=now();
      (data['assignment-history']||=[]).unshift({id:id(),entity_type:resourceName.replace(/-/g,'_'),entity_id:row.id,
        from_owner:previous,to_owner:person.id,changed_by:admin.id,reason:String(payload.reason||'Admin lead assignment'),created_at:now()});
      for(const task of data.followups||[])if(task.target_type===resourceName.replace(/-/g,'_')&&task.target_id===row.id&&
        task.owner_id===previous&&task.status==='pending'){
        task.owner_id=person.id;task.owner_name=person.full_name;
      }
    }
    save(data);return {data:{requested,changed,recipient:person.full_name}} as T;
  }
  if(base==='export')return {ok:true,data:{}} as T;
  const rows=data[base]||(data[base]=[]);
  if(method==='GET'){
    if(recordId)return {data:rows.find(x=>x.id===recordId)} as T;
    const filtered=listMatch(rows,String(query.get('q')||''),String(query.get('stage')||''));
    const page=Math.max(1,Number(query.get('page')||1)||1),limit=Math.min(100,Math.max(1,Number(query.get('limit')||50)||50));
    const offset=(page-1)*limit;
    return {data:filtered.slice(offset,offset+limit),has_more:filtered.length>offset+limit} as T;
  }
  if(method==='POST'&&action==='complete'){
    const row=rows.find(x=>x.id===recordId);if(!row||row.status!=='pending')throw new Error('Follow-up not found or already completed');
    Object.assign(row,{status:'done',channel:payload.channel,outcome:payload.outcome,notes:payload.notes,completed_by:admin.id,completed_at:now()});
    (data.activities||=[]).unshift({id:id(),target_type:row.target_type,target_id:row.target_id,actor_id:admin.id,
      employee_name:admin.full_name,channel:payload.channel,outcome:payload.outcome,notes:payload.notes,created_at:now()});
    if(payload.next_due_at)rows.unshift({id:id(),title:row.title,target_type:row.target_type,target_id:row.target_id,
      owner_id:row.owner_id,owner_name:row.owner_name,status:'pending',due_at:payload.next_due_at,created_at:now()});
    save(data);return {ok:true,data:row} as T;
  }
  if(method==='DELETE'){
    if(!['company-leads','candidates'].includes(base))throw new Error('Only company and candidate leads can be deleted.');
    const index=rows.findIndex(x=>x.id===recordId);if(index<0)throw new Error('Lead not found.');
    rows.splice(index,1);
    if(base==='candidates'){
      const removed=(data.resumes||[]).filter(r=>r.candidate_id===recordId).map(r=>String(r.id));
      data.resumes=(data.resumes||[]).filter(r=>r.candidate_id!==recordId);
      data.followups=(data.followups||[]).filter(r=>r.target_id!==recordId);
      data.activities=(data.activities||[]).filter(r=>r.target_id!==recordId);
      save(data);
      // Metadata is already gone; failed cleanup must not resurrect a deleted lead.
      await removeDemoResumeFiles(removed).catch(()=>undefined);
    }
    if(base==='company-leads')data.followups=(data.followups||[]).filter(r=>r.target_id!==recordId);
    save(data);return {ok:true,message:'Lead deleted successfully.'} as T;
  }
  if(method==='POST'){
    demoValidateCrm(base,payload,null);
    const duplicate=base==='candidates'&&rows.some(x=>(payload.email&&x.email===payload.email)||(payload.phone&&x.phone===payload.phone));
    if(duplicate)throw new Error('Candidate with this email or phone may already exist. Demo review required.');
    const owner=payload.owner_id||admin.id;
    const r={...payload,id:id(),owner_id:owner,owner_name:personName(data,owner),created_at:now()};rows.unshift(r);
    if(r.stage)(data['stage-history']||=[]).unshift({id:id(),entity_type:base.replace(/-/g,'_'),entity_id:r.id,
      old_stage:null,new_stage:r.stage,changed_by:admin.id,created_at:now()});
    save(data);return {data:r} as T;
  }
  const row=rows.find(x=>x.id===recordId);if(!row)throw new Error('Record not found');
  demoValidateCrm(base,payload,row);
  if(payload.stage!==undefined&&payload.stage!==row.stage)(data['stage-history']||=[]).unshift({
    id:id(),entity_type:base.replace(/-/g,'_'),entity_id:row.id,old_stage:row.stage||null,
    new_stage:payload.stage,changed_by:admin.id,created_at:now()});
  if(payload.owner_id!==undefined&&payload.owner_id!==row.owner_id){
    (data['assignment-history']||=[]).unshift({id:id(),entity_type:base.replace(/-/g,'_'),entity_id:row.id,
      from_owner:row.owner_id,to_owner:payload.owner_id,changed_by:admin.id,reason:'Admin reassignment',created_at:now()});
  }
  Object.assign(row,payload,{owner_name:personName(data,payload.owner_id||row.owner_id),updated_at:now()});
  save(data);return {data:row} as T;
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
export async function saveDemoResumeCandidate(values:Row,file:File,sha256:string,ownerId:string){
  const data=store();
  const dup=findDemoDuplicate(values,sha256);
  if(dup) return dup;
  const candidate={...values,id:id(),source:'resume',stage:String(values.stage||'new'),owner_id:ownerId||admin.id,owner_name:admin.full_name,created_at:now(),notes:[String(values.notes||''),'Development demo: parsed locally; resume file was not uploaded to cloud storage.'].filter(Boolean).join('\n')};
  const version={id:id(),candidate_id:candidate.id,original_filename:file.name,sha256,storage_key:'demo-indexeddb',mime_type:file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_size:file.size,created_at:now()};
  await saveDemoResumeFile(version.id,file);
  try {
    // Re-read after IndexedDB completes so another tab's new candidate is not overwritten.
    const latest=store();
    const subsequent=findDemoDuplicate(values,sha256);
    if(subsequent){await removeDemoResumeFiles([version.id]);return subsequent;}
    latest.candidates.unshift(candidate);(latest.resumes||=[]).unshift(version);save(latest);
  } catch(error){await removeDemoResumeFiles([version.id]).catch(()=>undefined);throw error;}
  return {created:true,message:'Candidate and resume saved to this browser. Open or download the file from the candidate details.',data:{candidate_id:String(candidate.id),resume_version_id:String(version.id)}};
}
export async function attachDemoResume(candidateId:string,file:File,sha256:string){
  const data=store();
  if(!data.candidates.some(r=>r.id===candidateId))throw new Error('Candidate not found.');
  if((data.resumes||[]).some(r=>r.sha256===sha256))throw new Error('This exact resume has already been uploaded.');
  const version={id:id(),candidate_id:candidateId,original_filename:file.name,sha256,storage_key:'demo-indexeddb',mime_type:file.name.toLowerCase().endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_size:file.size,created_at:now()};
  await saveDemoResumeFile(version.id,file);
  try {
    const latest=store();
    if(!latest.candidates.some(r=>r.id===candidateId))throw new Error('Candidate was deleted before resume attachment completed.');
    if((latest.resumes||[]).some(r=>r.sha256===sha256))throw new Error('This resume has already been attached.');
    (latest.resumes||=[]).unshift(version);save(latest);
  } catch(error){await removeDemoResumeFiles([version.id]).catch(()=>undefined);throw error;}
  return {created:true,message:'Resume saved and attached to the existing candidate in this browser.',data:{candidate_id:candidateId,resume_version_id:String(version.id)}};
}
