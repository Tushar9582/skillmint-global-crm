import { randomUUID } from 'node:crypto';
import { api, json } from '@/lib/http';
import { HttpError, normalizeEmail, normalizePhone } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { getRecord, UUID } from '@/lib/records';
import { downloadResume, removeResume, storeResume } from '@/lib/storage';
import { extractText, parseResume, sha256, validateResume } from '@/lib/resume';
import { scanResume } from '@/lib/antivirus';
import { workflowSettings } from '@/lib/crm-config';

export const GET=api(async(request,actor)=>{
  const candidateId=request.nextUrl.searchParams.get('candidate_id')||'';
  if(!UUID.test(candidateId)) throw new HttpError(400,'Candidate ID required');
  await getRecord(actor,'candidates',candidateId);
  const list=await sql(
    `SELECT id,candidate_id,original_filename,mime_type,file_size,sha256,uploaded_by,created_at
     FROM resume_versions WHERE organization_id=$1 AND candidate_id=$2 ORDER BY created_at DESC`,
    [actor.organization_id,candidateId]);
  return json({data:list});
});

export const POST=api(async(request,actor)=>{
  const form=await request.formData();
  const file=form.get('file');
  if(!(file instanceof File)) throw new HttpError(400,'Please select a PDF or DOCX resume');
  const bytes=Buffer.from(await file.arrayBuffer());
  const mime=validateResume(file.name,bytes);
  await scanResume(bytes);
  const hash=sha256(bytes);
  const existing=await one<{candidate_id:string;owner_id:string;full_name:string}>(
    `SELECT r.candidate_id,c.owner_id,c.full_name FROM resume_versions r
     JOIN candidates c ON c.id=r.candidate_id AND c.organization_id=r.organization_id
     WHERE r.organization_id=$1 AND r.sha256=$2 LIMIT 1`,[actor.organization_id,hash]);
  if(existing) {
    const visible=actor.role==='admin' || existing.owner_id===actor.id;
    return json({duplicate:true,kind:'exact',message:'This exact resume file is already uploaded.',
      existing_candidate_id:visible?existing.candidate_id:null,
      existing_candidate_name:visible?existing.full_name:null},409);
  }

  const parsedText=await extractText(bytes,mime);
  const preview=form.get('preview')==='1';
  if(preview && parsedText.trim().length<40) throw new HttpError(422,'Unable to extract text from this resume. It may be scanned/image-based and requires OCR or manual entry.');
  const parsed=parseResume(parsedText,file.name);
  const edited=form.get('fields');
  let notes='';
  if(!preview && typeof edited==='string' && edited) {
    let values:Record<string,unknown>;
    try {values=JSON.parse(edited);} catch {throw new HttpError(400,'Invalid candidate details');}
    const str=(v:unknown)=>{const s=String(v??'').trim();return s||null;};
    const num=(v:unknown)=>{const n=Number(v);return v===''||v==null||!Number.isFinite(n)?null:n;};
    const name=str(values.full_name);
    if(!name) throw new HttpError(400,'Candidate name is required');
    Object.assign(parsed,{
      full_name:name,email:str(values.email),phone:str(values.phone),location:str(values.location),
      skills:(Array.isArray(values.skills)?values.skills:String(values.skills||'').split(',')).map(s=>String(s).trim()).filter(Boolean),
      experience_years:num(values.experience_years),notice_period:str(values.notice_period),
      preferred_role:str(values.preferred_role),expected_ctc:num(values.expected_ctc),
      current_designation:str(values.current_designation),education:str(values.education),
      current_company:str(values.current_company),parse_status:'ready',
    });
    parsed.normalized_email=normalizeEmail(parsed.email);
    parsed.normalized_phone=normalizePhone(parsed.phone);
    notes=[parsed.current_designation&&`Current designation: ${parsed.current_designation}`,
      parsed.current_company&&`Current company: ${parsed.current_company}`,
      parsed.education&&`Education: ${parsed.education}`,str(values.notes)].filter(Boolean).join('\n');
  }
  const requestedOwner=String(form.get('owner_id')||actor.id);
  const owner=actor.role==='admin'?requestedOwner:actor.id;
  const candidateId=String(form.get('candidate_id')||'');
  if(candidateId) await getRecord(actor,'candidates',candidateId);
  const activeOwner=await one('SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND active=true',
    [owner,actor.organization_id]);
  if(!activeOwner) throw new HttpError(400,'Recruiter is not active');
  const ext=mime==='application/pdf'?'pdf':'docx';
  const key=`${actor.organization_id}/${randomUUID()}/${randomUUID()}.${ext}`;
  const match=(!candidateId && (parsed.normalized_email || parsed.normalized_phone))
    ? await one<{id:string;owner_id:string;full_name:string}>(
      `SELECT id,owner_id,full_name FROM candidates
       WHERE organization_id=$1 AND (($2::text IS NOT NULL AND normalized_email=$2)
         OR ($3::text IS NOT NULL AND normalized_phone=$3)) LIMIT 1`,
      [actor.organization_id,parsed.normalized_email,parsed.normalized_phone])
    : null;

  if(preview) {
    const visible=!match||actor.role==='admin'||match.owner_id===actor.id;
    return json({preview:true,parsed,sha256:hash,
      duplicate:match?{kind:'identity',existing_candidate_id:visible?match.id:null,existing_candidate_name:visible?match.full_name:null}:null});
  }

  await storeResume(key,bytes,mime);
  try {
    if(match) {
      const review=await transaction(async client=>{
        const rows=await sql<{id:string}>(
          `INSERT INTO duplicate_reviews(organization_id,matched_candidate_id,upload_key,
             upload_hash,upload_name,mime_type,size_bytes,parsed_data,extracted_text,owner_id,uploaded_by,reason)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
          [actor.organization_id,match.id,key,hash,file.name,mime,bytes.length,
           JSON.stringify(parsed),parsedText,owner,actor.id,'Candidate email or phone matches an existing record'],client);
        await audit(actor,'resume_duplicate_pending','duplicate_reviews',rows[0].id,
          {matched_candidate_id:match.id},client);
        return rows[0].id;
      });
      const visible=actor.role==='admin'||match.owner_id===actor.id;
      return json({duplicate:true,kind:'identity',review_id:review,
        message:'Possible existing candidate found. Admin review required before creating another lead.',
        existing_candidate_id:visible?match.id:null,
        parsed},202);
    }
    const created=await transaction(async client=>{
      const id = candidateId || (await one<{id:string}>(
        `INSERT INTO candidates(organization_id,full_name,email,phone,normalized_email,normalized_phone,
          location,skills,experience_years,notice_period,preferred_role,source,owner_id,created_by,parse_status,expected_ctc,notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'resume',$12,$13,$14,$15,$16) RETURNING id`,
        [actor.organization_id,parsed.full_name,parsed.email,parsed.phone,
         parsed.normalized_email,parsed.normalized_phone,parsed.location,parsed.skills,
         parsed.experience_years,parsed.notice_period,parsed.preferred_role,owner,actor.id,parsed.parse_status,
         parsed.expected_ctc,notes||null],client))?.id;
      if(!id) throw new HttpError(500,'Unable to create candidate');
      const version=await one<{id:string}>(
        `INSERT INTO resume_versions(organization_id,candidate_id,sha256,original_filename,
          storage_key,mime_type,file_size,extracted_text,uploaded_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [actor.organization_id,id,hash,file.name,key,mime,bytes.length,parsedText,actor.id],client);
      if(!candidateId) {
        await sql(`INSERT INTO assignment_history(organization_id,entity_type,entity_id,to_owner,changed_by,reason)
                   VALUES($1,'candidates',$2,$3,$4,'Auto-created from resume')`,
          [actor.organization_id,id,owner,actor.id],client);
        const followDays=(await workflowSettings(actor.organization_id,client)).resume_followup_days;
        if(followDays>0) await sql(`INSERT INTO followups(organization_id,target_type,target_id,owner_id,due_at,title,created_by)
                   VALUES($1,'candidates',$2,$3,now()+make_interval(days=>$6::int),$4,$5)`,
          [actor.organization_id,id,owner,`Screen ${parsed.full_name}`,actor.id,followDays],client);
      }
      await audit(actor,candidateId?'resume_version_added':'resume_candidate_created','candidates',id,
        {resume_version_id:version?.id,parse_status:parsed.parse_status},client);
      return {candidate_id:id,resume_version_id:version?.id};
    });
    return json({created:true,data:created,parsed,
      message:parsed.parse_status==='ready'?'Candidate lead created from resume':'Candidate lead created; please review missing extracted fields.'},201);
  } catch(error) {
    await removeResume(key);
    throw error;
  }
});
