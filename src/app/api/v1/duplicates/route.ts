import { api, body, json } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';
import { UUID } from '@/lib/records';
import { removeResume } from '@/lib/storage';
import type { ExtractedCandidate } from '@/lib/resume';

export const GET=api(async(_request,actor)=>{
  ensureAdmin(actor);
  return json({data:await sql(
    `SELECT d.id,d.matched_candidate_id,d.upload_name,d.upload_hash,d.parsed_data,d.reason,
      d.status,d.created_at,c.full_name AS matched_candidate_name,u.full_name AS uploaded_by_name
     FROM duplicate_reviews d
     LEFT JOIN candidates c ON c.id=d.matched_candidate_id AND c.organization_id=d.organization_id
     LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.organization_id=$1 ORDER BY (d.status='pending') DESC,d.created_at DESC LIMIT 100`,
    [actor.organization_id])});
});

export const PATCH=api(async(request,actor)=>{
  ensureAdmin(actor);
  const data=await body(request);
  const id=String(data.id||'');
  const action=String(data.action||'');
  const reason=String(data.reason||'').trim();
  if(!UUID.test(id) || !['attach_existing','create_separate','discard'].includes(action))
    throw new HttpError(400,'Invalid duplicate decision');
  if(action==='create_separate' && reason.length<8) throw new HttpError(400,'Justification is required to keep separate');
  const result=await transaction(async client=>{
    const review=await one<{
      id:string;status:string;matched_candidate_id:string;parsed_data:ExtractedCandidate;
      owner_id:string;upload_key:string;upload_hash:string;upload_name:string;mime_type:string;
      size_bytes:number;extracted_text:string;uploaded_by:string;
    }>(
      `SELECT * FROM duplicate_reviews WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [actor.organization_id,id],client);
    if(!review) throw new HttpError(404,'Review not found');
    if(review.status!=='pending') throw new HttpError(409,'Already reviewed');
    let candidateId:string|null=null;
    if(action==='attach_existing') {
      const matched=await one('SELECT id FROM candidates WHERE id=$1 AND organization_id=$2',
        [review.matched_candidate_id,actor.organization_id],client);
      if(!matched) throw new HttpError(404,'Original candidate not found');
      candidateId=review.matched_candidate_id;
    }
    if(action==='create_separate') {
      const p=review.parsed_data;
      const created=await one<{id:string}>(
        `INSERT INTO candidates(organization_id,full_name,email,phone,normalized_email,normalized_phone,
          location,skills,experience_years,notice_period,preferred_role,source,owner_id,created_by,parse_status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'resume',$12,$13,$14) RETURNING id`,
        [actor.organization_id,p.full_name,p.email,p.phone,p.normalized_email,p.normalized_phone,
         p.location,p.skills,p.experience_years,p.notice_period,p.preferred_role,
         review.owner_id,review.uploaded_by,p.parse_status],client);
      candidateId=created!.id;
    }
    if(candidateId) await sql(
      `INSERT INTO resume_versions(organization_id,candidate_id,sha256,original_filename,
        storage_key,mime_type,file_size,extracted_text,uploaded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actor.organization_id,candidateId,review.upload_hash,review.upload_name,review.upload_key,
       review.mime_type,review.size_bytes,review.extracted_text,review.uploaded_by],client);
    await sql(
      `UPDATE duplicate_reviews SET status=$1,resolved_by=$2,resolved_at=now() WHERE id=$3`,
      [action,actor.id,id],client);
    await audit(actor,'duplicate_review_resolved','duplicate_reviews',id,{action,candidate_id:candidateId,reason},client);
    return {candidate_id:candidateId,action,remove_key:action==='discard'?review.upload_key:null};
  });
  if(result.remove_key) await removeResume(result.remove_key);
  return json({data:{candidate_id:result.candidate_id,action:result.action}});
});
