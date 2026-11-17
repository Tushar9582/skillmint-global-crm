/** Built-in, print-ready themes. The selected ID is stored with each cloud draft. */
export const RESUME_TEMPLATES = [
  {id:'executive',name:'Executive Blue',description:'Confident navy styling',category:'Professional'},
  {id:'minimal',name:'Minimal White',description:'Clean monochrome layout',category:'ATS-focused'},
  {id:'modern',name:'Modern Teal',description:'Fresh, contemporary accents',category:'Modern'},
  {id:'classic',name:'Classic Serif',description:'Traditional formal typography',category:'ATS-focused'},
  {id:'corporate',name:'Corporate Navy',description:'Structured business profile',category:'Professional'},
  {id:'compact',name:'Compact Graphite',description:'More information per page',category:'ATS-focused'},
  {id:'elegant',name:'Elegant Plum',description:'Refined editorial appearance',category:'Modern'},
  {id:'creative',name:'Creative Amber',description:'Warm and distinctive profile',category:'Modern'},
] as const;

export type ResumeTemplate = (typeof RESUME_TEMPLATES)[number]['id'];

export type ResumeExperience={
  id:string;role:string;company:string;period:string;details:string;
};
export type ResumeEducation={
  id:string;degree:string;institution:string;year:string;
};
export type ResumeProject={
  id:string;name:string;details:string;
};

export type ResumeDraft={
  id:string;candidateId:string;template:ResumeTemplate;updatedAt:string;
  fullName:string;professionalTitle:string;email:string;phone:string;location:string;
  linkedin:string;portfolio:string;summary:string;skills:string;certifications:string;
  experience:ResumeExperience[];education:ResumeEducation[];projects:ResumeProject[];
  targetJobDescription:string;
};

export function createResumeDraft():ResumeDraft {
  return {
    id:crypto.randomUUID(),candidateId:'',template:'executive',updatedAt:new Date().toISOString(),
    fullName:'',professionalTitle:'',email:'',phone:'',location:'',linkedin:'',portfolio:'',
    summary:'',skills:'',certifications:'',experience:[],education:[],projects:[],targetJobDescription:'',
  };
}

export function resumeLines(value:string):string[] {
  return value.split(/\r?\n/).map(line=>line.trim().replace(/^[•*\-]\s*/, '')).filter(Boolean);
}

export function resumeSkills(value:string):string[] {
  return value.split(/[,\n]/).map(skill=>skill.trim()).filter(Boolean).slice(0,40);
}

/** An offline starter sentence from explicitly entered facts; this is a template, not AI. */
export function starterResumeSummary(draft:Pick<ResumeDraft,'professionalTitle'|'skills'>):string {
  const role=draft.professionalTitle.trim();
  const skills=resumeSkills(draft.skills).slice(0,5);
  if(!role&&!skills.length)return '';
  if(role&&skills.length)return `${role} with skills in ${skills.join(', ')}. Focused on delivering reliable work, collaborating with teams, and developing professional expertise.`;
  if(role)return `${role} focused on developing professional expertise, collaborating with teams, and delivering reliable work.`;
  return `Professional with skills in ${skills.join(', ')}. Focused on applying these capabilities in a collaborative work environment.`;
}

export function safeResumeUrl(value:string):string|null {
  if(!value.trim())return null;
  try {
    const url=new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);
    return ['http:','https:'].includes(url.protocol)?url.toString():null;
  } catch{return null;}
}

export function candidateResumeFields(candidate:Record<string,unknown>):Partial<ResumeDraft> {
  return {
    candidateId:String(candidate.id||''),
    fullName:String(candidate.full_name||''),
    professionalTitle:String(candidate.preferred_role||candidate.current_designation||''),
    email:String(candidate.email||''),phone:String(candidate.phone||''),
    location:String(candidate.location||''),
    skills:Array.isArray(candidate.skills)?candidate.skills.map(String).join(', '):String(candidate.skills||''),
  };
}

export function isResumeDraft(value:unknown):value is ResumeDraft {
  if(!value||typeof value!=='object')return false;
  const row=value as Record<string,unknown>;
  const textKeys=['id','candidateId','updatedAt','fullName','professionalTitle','email','phone','location',
    'linkedin','portfolio','summary','skills','certifications','targetJobDescription'];
  const item=(value:unknown,keys:string[])=>value!==null&&typeof value==='object'&&
    keys.every(key=>typeof (value as Record<string,unknown>)[key]==='string');
  return textKeys.every(key=>typeof row[key]==='string')
    &&Array.isArray(row.experience)&&row.experience.every(value=>item(value,['id','role','company','period','details']))
    &&Array.isArray(row.education)&&row.education.every(value=>item(value,['id','degree','institution','year']))
    &&Array.isArray(row.projects)&&row.projects.every(value=>item(value,['id','name','details']))
    &&RESUME_TEMPLATES.some(template=>template.id===row.template);
}
