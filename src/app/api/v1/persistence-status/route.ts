import {api,json} from '@/lib/http';
import {ensureAdmin} from '@/lib/auth';
import {one} from '@/lib/db';
import {resumeStorageReady} from '@/lib/storage';
export const GET=api(async(_request,actor)=>{
 ensureAdmin(actor);
 const counts=await one<{candidates:number;leads:number;resumes:number}>(`SELECT (SELECT count(*)::int FROM candidates WHERE organization_id=$1 AND deleted_at IS NULL) candidates,(SELECT count(*)::int FROM company_leads WHERE organization_id=$1 AND deleted_at IS NULL) leads,(SELECT count(*)::int FROM resume_versions WHERE organization_id=$1) resumes`,[actor.organization_id]);
 return json({database:'connected',scope:'company',counts,resume_storage_reachable:await resumeStorageReady(),antivirus_configured:Boolean(process.env.CLAMAV_HOST),note:'Storage check is read-only; scanner configuration does not prove scanner connectivity.'});
});
