import { api, json } from '@/lib/http';
import { HttpError } from '@/lib/auth';
import { sql, one } from '@/lib/db';
import { UUID } from '@/lib/records';
import { isResumeDraft, type ResumeDraft } from '@/lib/resume-builder';

type DraftRow={ content:ResumeDraft };

export const GET=api(async(_request,actor)=>{
  const rows=await sql<DraftRow>(
    `SELECT content FROM resume_builder_drafts
     WHERE organization_id=$1 AND owner_id=$2 ORDER BY updated_at DESC LIMIT 20`,
    [actor.organization_id,actor.id],
  );
  return json({data:rows.map(row=>row.content).filter(isResumeDraft)});
});

export const PUT=api(async(request,actor)=>{
  const payload:unknown=await request.json();
  const raw=JSON.stringify(payload);
  if(Buffer.byteLength(raw,'utf8')>100_000)throw new HttpError(413,'Resume draft is too large');
  if(!isResumeDraft(payload))throw new HttpError(400,'Invalid resume draft');
  const draft=payload as ResumeDraft;
  if(!UUID.test(draft.id)||!Number.isFinite(Date.parse(draft.updatedAt)))
    throw new HttpError(400,'Invalid draft ID or update timestamp');

  const candidateId=draft.candidateId||null;
  if(candidateId) {
    if(!UUID.test(candidateId))throw new HttpError(400,'Invalid candidate');
    const candidate=await one(
      `SELECT id FROM candidates WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
       AND ($3='admin' OR owner_id=$4)`,
      [candidateId,actor.organization_id,actor.role,actor.id],
    );
    if(!candidate)throw new HttpError(404,'Candidate not found or not assigned');
  }

  const written=await sql<{id:string}>(
    `INSERT INTO resume_builder_drafts(id,organization_id,owner_id,candidate_id,content)
     VALUES($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       candidate_id=EXCLUDED.candidate_id,
       content=EXCLUDED.content,
       updated_at=now()
     WHERE resume_builder_drafts.organization_id=EXCLUDED.organization_id
       AND resume_builder_drafts.owner_id=EXCLUDED.owner_id
       AND (resume_builder_drafts.content->>'updatedAt')::timestamptz
         <= (EXCLUDED.content->>'updatedAt')::timestamptz
     RETURNING id`,
    [draft.id,actor.organization_id,actor.id,candidateId,raw],
  );
  if(!written.length) {
    // Older in-flight saves must not overwrite newer autosave requests.
    const owner=await one<{id:string}>(
      'SELECT id FROM resume_builder_drafts WHERE id=$1 AND organization_id=$2 AND owner_id=$3',
      [draft.id,actor.organization_id,actor.id],
    );
    if(!owner)throw new HttpError(409,'Draft ID is already owned by another account');
    return json({saved:true,stale:true});
  }
  return json({saved:true,id:draft.id});
});

export const DELETE=api(async(request,actor)=>{
  const id=request.nextUrl.searchParams.get('id')||'';
  if(!UUID.test(id))throw new HttpError(400,'Valid draft ID required');
  await sql('DELETE FROM resume_builder_drafts WHERE id=$1 AND organization_id=$2 AND owner_id=$3',
    [id,actor.organization_id,actor.id]);
  return json({deleted:true});
});
