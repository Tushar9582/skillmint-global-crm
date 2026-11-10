export type InputType='text'|'email'|'tel'|'number'|'date'|'datetime-local'|'textarea'|'select'|'user'|'client'|'job'|'candidate'|'application'|'skills';
export interface Field {
  name:string;
  label:string;
  type:InputType;
  required?:boolean;
  options?:string[];
}
export interface ResourceDefinition {
  key:string;
  table:string;
  singular:string;
  plural:string;
  icon:string;
  description:string;
  fields:Field[];
  columns:string[];
  stages?:string[];
}

const select=(name:string,label:string,options:string[],required=false):Field=>({name,label,type:'select',options,required});
const text=(name:string,label:string,required=false):Field=>({name,label,type:'text',required});
const date=(name:string,label:string):Field=>({name,label,type:'datetime-local'});
const owner:Field={name:'owner_id',label:'Assigned Recruiter',type:'user'};
const priority=select('priority','Priority',['low','medium','high','urgent']);

export const CATALOG:Record<string,ResourceDefinition>={
  'company-leads':{
    key:'company-leads',table:'company_leads',singular:'Company Lead',plural:'Company Leads',icon:'building',
    description:'Employer prospects, decision-makers and the company acquisition pipeline.',
    stages:['new','assigned','contact_attempted','connected','requirement_discussed','qualified','converted','not_interested','unreachable','closed'],
    fields:[text('company_name','Company Name',true),text('industry','Industry'),text('website','Website'),text('city','City / Location'),
      text('contact_name','Decision Maker'),text('contact_title','Designation'),{name:'email',label:'Contact Email',type:'email'},
      {name:'phone',label:'Contact Phone',type:'tel'},select('source','Lead Source',['manual','website','referral','linkedin','import','other']),
      select('stage','Lead Stage',['new','assigned','contact_attempted','connected','requirement_discussed','qualified','converted','not_interested','unreachable','closed']),
      priority,owner,date('next_followup_at','First / Next Follow-up'),{name:'notes',label:'Notes',type:'textarea'}],
    columns:['company_name','contact_name','phone','stage','priority','owner_name','next_followup_at'],
  },
  clients:{
    key:'clients',table:'clients',singular:'Client Account',plural:'Clients & Contacts',icon:'briefcase',
    description:'Qualified employer accounts, hiring contacts and staffing agreements.',
    fields:[text('company_name','Client / Company Name',true),text('industry','Industry'),text('city','Location'),
      text('contact_name','Hiring Contact'),{name:'contact_email',label:'Email',type:'email'},
      {name:'contact_phone',label:'Phone',type:'tel'}, {name:'service_terms',label:'Terms / Agreement Notes',type:'textarea'}, owner],
    columns:['company_name','contact_name','contact_email','city','owner_name'],
  },
  jobs:{
    key:'jobs',table:'jobs',singular:'Job Requisition',plural:'Job Requisitions',icon:'layers',
    description:'Client vacancies, required skills, openings, compensation and recruiting progress.',
    stages:['draft','open','sourcing','interviewing','offer','partially_filled','filled','closed','cancelled'],
    fields:[{name:'client_id',label:'Client Account',type:'client',required:true},text('title','Job Title',true),text('department','Department'),
      text('location','Location'),select('work_mode','Work Mode',['office','hybrid','remote']),
      {name:'skills',label:'Required Skills (comma separated)',type:'skills'},
      {name:'openings',label:'Number of Openings',type:'number'},
      {name:'salary_min',label:'Salary Min (annual)',type:'number'},
      {name:'salary_max',label:'Salary Max (annual)',type:'number'},
      {name:'experience_min',label:'Minimum Experience (years)',type:'number'},
      {name:'experience_max',label:'Maximum Experience (years)',type:'number'},
      {name:'required_by',label:'Required By',type:'date'},
      select('stage','Job Stage',['draft','open','sourcing','interviewing','offer','partially_filled','filled','closed','cancelled']),priority,owner],
    columns:['title','client_name','location','openings','stage','owner_name'],
  },
  candidates:{
    key:'candidates',table:'candidates',singular:'Candidate Lead',plural:'Lead Bank & Resumes',icon:'users',
    description:'One candidate identity with resume versions, screening and application history.',
    stages:['new','assigned','contact_attempted','connected','screened','eligible','not_eligible','on_hold','placed','rejected'],
    fields:[text('full_name','Candidate Full Name',true),{name:'email',label:'Email Address',type:'email'},
      {name:'phone',label:'Mobile Number',type:'tel'},text('location','Current Location'),
      {name:'skills',label:'Skills (comma separated)',type:'skills'},
      {name:'experience_years',label:'Experience (years)',type:'number'},
      {name:'expected_ctc',label:'Expected CTC (annual)',type:'number'},
      text('notice_period','Notice Period'),text('preferred_role','Preferred Role'),
      select('source','Candidate Source',['manual','resume','referral','website','linkedin','import','other']),
      select('stage','Candidate Stage',['new','assigned','contact_attempted','connected','screened','eligible','not_eligible','on_hold','placed','rejected']),
      owner,{name:'notes',label:'Notes',type:'textarea'}],
    columns:['full_name','email','phone','location','skills','stage','owner_name'],
  },
  applications:{
    key:'applications',table:'applications',singular:'Job Application',plural:'Applications',icon:'workflow',
    description:'Candidate-to-vacancy submissions, interview stages, offers and placements.',
    stages:['shortlisted','submitted','interview_scheduled','interviewed','selected','offered','joined','rejected','withdrawn','on_hold'],
    fields:[{name:'candidate_id',label:'Candidate',type:'candidate',required:true},
      {name:'job_id',label:'Job Requirement',type:'job',required:true},
      select('stage','Application Stage',['shortlisted','submitted','interview_scheduled','interviewed','selected','offered','joined','rejected','withdrawn','on_hold']),
      {name:'fit_notes',label:'Fit / Submission Notes',type:'textarea'},
      {name:'submitted_at',label:'Submitted At',type:'datetime-local'},
      {name:'joined_at',label:'Joining Date',type:'date'},owner],
    columns:['candidate_name','job_title','stage','submitted_at','joined_at','owner_name'],
  },
  interviews:{
    key:'interviews',table:'interviews',singular:'Interview',plural:'Interviews',icon:'calendar',
    description:'Interview schedules, interviewers, meeting links, feedback and outcomes.',
    fields:[{name:'application_id',label:'Candidate Application',type:'application',required:true},
      text('round_label','Interview Round',true),select('mode','Interview Mode',['video','phone','in_person']),
      {name:'scheduled_at',label:'Interview Date & Time',type:'datetime-local',required:true},
      text('meeting_link','Meeting Link'),text('location','Venue / Location'),text('interviewer','Interviewer'),
      select('outcome','Outcome',['scheduled','completed','rescheduled','cancelled','passed','failed']),
      {name:'feedback',label:'Feedback',type:'textarea'},owner],
    columns:['candidate_name','job_title','round_label','scheduled_at','outcome','owner_name'],
  },
  followups:{
    key:'followups',table:'followups',singular:'Follow-up',plural:'Follow-up Center',icon:'clock',
    description:'Today, overdue and upcoming calls, meetings and recruiter commitments.',
    fields:[select('target_type','Related Record Type',['company_leads','candidates','applications'],true),
      text('target_id','Related Record ID',true),text('title','Follow-up Title',true),
      {name:'due_at',label:'Due Date & Time',type:'datetime-local',required:true},
      priority,owner],
    columns:['title','target_type','due_at','status','priority','owner_name'],
  },
};

export const RESOURCE_TABLES=Object.fromEntries(Object.entries(CATALOG).map(([key,def])=>[key,def.table]));

export function formatKey(key:string):string {
  return key.replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
}
