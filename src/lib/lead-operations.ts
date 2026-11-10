/** Shared validation used by database-backed and isolated-browser lead workflows. */
export const LEAD_RESOURCES=['company-leads','candidates','applications'] as const;
export const isLeadResource=(value:string)=>LEAD_RESOURCES.some(resource=>resource===value);

export interface AssignmentRange {from:number;to:number;search:string;stage:string}
export function parseAssignmentRange(value:unknown):AssignmentRange {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Choose a valid row range');
  const source=value as Record<string,unknown>;
  const from=Number(source.from);
  const to=Number(source.to);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from||to-from+1>200||to>10000)
    throw new Error('Choose a range of 1–200 rows between positions 1 and 10,000');
  const search=String(source.search||'').trim().slice(0,100);
  const stage=String(source.stage||'').trim().slice(0,100);
  return {from,to,search,stage};
}

export interface ProgressPeriod {from:string;to:string;startIso:string;endExclusiveIso:string}
export function parseProgressPeriod(from:string,to:string):ProgressPeriod {
  const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    Number.isFinite(new Date(`${value}T00:00:00+05:30`).getTime())&&
    new Date(new Date(`${value}T00:00:00+05:30`).getTime()+330*60000).toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to))throw new Error('Enter valid report dates');
  const start=new Date(`${from}T00:00:00+05:30`).getTime();
  const end=new Date(`${to}T00:00:00+05:30`).getTime();
  if(end<start||end-start>90*86400000)throw new Error('Choose a date range of up to 91 days');
  return {from,to,startIso:new Date(start).toISOString(),endExclusiveIso:new Date(end+86400000).toISOString()};
}

export interface RecruiterProgress {
  id:string;full_name:string;team:string;active:boolean;
  company_leads:number;candidates:number;applications:number;
  activities:number;calls:number;meetings:number;stage_updates:number;
  followups_done:number;interviews_scheduled:number;pending_followups:number;
  last_activity_at:string|null;
}

export function emptyRecruiterProgress(person:{id:string;full_name:string;team?:unknown;active?:unknown}):RecruiterProgress {
  return {id:person.id,full_name:person.full_name,team:String(person.team||''),active:person.active!==false,
    company_leads:0,candidates:0,applications:0,activities:0,calls:0,meetings:0,stage_updates:0,
    followups_done:0,interviews_scheduled:0,pending_followups:0,last_activity_at:null};
}
