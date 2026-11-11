import { z } from 'zod';
import { HttpError } from '@/lib/auth';
import { api, json } from '@/lib/http';

const experienceInput=z.object({
  id:z.string().min(1).max(100),role:z.string().max(180),company:z.string().max(180),
  period:z.string().max(120),details:z.string().max(2500),
});

const requestSchema=z.object({
  fullName:z.string().min(2).max(180),professionalTitle:z.string().max(180),
  summary:z.string().max(3500),skills:z.string().max(2200),
  experience:z.array(experienceInput).max(8),
  targetJobDescription:z.string().max(9000),
});

const responseSchema={
  type:'object',additionalProperties:false,
  properties:{
    summary:{type:'string'},
    experience:{type:'array',items:{type:'object',additionalProperties:false,
      properties:{id:{type:'string'},bullets:{type:'array',items:{type:'string'}}},
      required:['id','bullets']}},
  },required:['summary','experience'],
};

const quota=new Map<string,{start:number;count:number}>();

export const POST=api(async(request,actor)=>{
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)throw new HttpError(503,'AI rewriting is not configured yet. You can still create, edit, save and export resumes manually.');

  const payload=requestSchema.parse(await request.json());
  if(!payload.summary.trim()&&!payload.experience.some(row=>row.details.trim()))
    throw new HttpError(400,'Add a professional summary or work experience before requesting AI improvements.');

  // Best-effort per-session throttle. A gateway-level rate limit should also be configured for production.
  const key=`${actor.organization_id}:${actor.id}`,now=Date.now();
  const previous=quota.get(key);
  const bucket=!previous||now-previous.start>=3600000?{start:now,count:0}:previous;
  if(bucket.count>=10)throw new HttpError(429,'Hourly AI request limit reached. Please try again later.');
  bucket.count++;quota.set(key,bucket);
  if(quota.size>2000)for(const [id,item] of quota)if(now-item.start>3600000)quota.delete(id);

  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:process.env.OPENAI_RESUME_MODEL||'gpt-4o-mini',
      max_output_tokens:1700,
      instructions:'You are an expert recruitment resume editor. Rewrite the professional summary and work-experience bullet points to be clear, concise, ATS-friendly and relevant to the supplied target job description. Never invent or assume degrees, employers, dates, metrics, achievements, technologies, job duties or credentials. Only use facts supplied in the input. If details are insufficient, keep a factual short description. Use action-oriented wording where justified. Maintain exact experience item IDs and their original order. Output only the specified JSON schema.',
      input:JSON.stringify(payload),
      text:{format:{type:'json_schema',name:'resume_enhancement',strict:true,schema:responseSchema}},
    }),
  });
  if(!response.ok) {
    console.error('[resume-ai] provider HTTP status',response.status);
    throw new HttpError(502,'AI rewriting is temporarily unavailable. Your resume draft has been preserved.');
  }

  const raw=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
  const text=raw.output?.flatMap(entry=>entry.content||[]).find(item=>item.type==='output_text')?.text;
  if(!text)throw new HttpError(502,'AI did not return a complete revision. Please try again.');
  let parsed:unknown;
  try{parsed=JSON.parse(text);}catch{throw new HttpError(502,'AI returned an invalid revision. Please try again.');}
  const result=z.object({summary:z.string().max(3500),experience:z.array(z.object({
    id:z.string(),bullets:z.array(z.string().max(450)).max(7),
  })).max(8)}).safeParse(parsed);
  if(!result.success)throw new HttpError(502,'AI returned a revision with unexpected fields. Please try again.');

  // Never allow a model-generated ID to introduce an unrelated experience entry.
  const allowed=new Set(payload.experience.map(item=>item.id));
  return json({data:{summary:result.data.summary,experience:result.data.experience.filter(item=>allowed.has(item.id))}});
});
