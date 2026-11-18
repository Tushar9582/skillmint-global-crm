import {HttpError,type Actor} from './auth';
import {one,sql} from './db';
export function searchTerms(raw:string){
 const input=raw.trim();if(input.length>300)throw new HttpError(400,'Search is limited to 300 characters.');
 const tokens=input.match(/"[^"]+"|[^\s"]+/g)||[];
 if(tokens.length>24)throw new HttpError(400,'Use up to 24 keywords and operators.');
 // OR separates groups; AND is implicit; NOT excludes the next term.
 const groups:string[][]=[[]];const excludes:string[]=[];let negate=false;
 for(const token of tokens){const upper=token.toUpperCase();if(upper==='AND')continue;if(upper==='OR'){if(negate||!groups[groups.length-1].length)throw new HttpError(400,'Enter a keyword before OR.');groups.push([]);continue;}if(upper==='NOT'){negate=true;continue;}
 const term=token.replace(/^"|"$/g,'');if(!/[\p{L}\p{N}]/u.test(term))continue;
 if(negate){excludes.push(term);negate=false;}else groups[groups.length-1].push(term);}
 if(negate||(groups.length>1&&!groups[groups.length-1].length))throw new HttpError(400,'Enter a keyword after the operator.');
 return {groups:groups.filter(g=>g.length),excludes};
}
export function buildResumeSearch(actor:Actor,p:URLSearchParams){
 const terms=searchTerms(p.get('q')||'');const args:unknown[]=[actor.organization_id];const add=(v:unknown)=>{args.push(v);return '$'+args.length;};
 const conditions=['c.organization_id=$1','c.deleted_at IS NULL'];if(actor.role!=='admin')conditions.push('c.owner_id='+add(actor.id));
 const candidate="public.hrdiary_candidate_search(c.full_name,c.skills,c.preferred_role,c.notes)";
 const vector="to_tsvector('pg_catalog.simple'::regconfig,public.hrdiary_search_text(r.extracted_text))";
 const termMatch=(term:string)=>{const q="phraseto_tsquery('pg_catalog.simple'::regconfig,public.hrdiary_search_text("+add(term)+"::text))";return '('+candidate+' @@ '+q+' OR c.id IN (SELECT r.candidate_id FROM resume_versions r WHERE r.organization_id=$1 AND '+vector+' @@ '+q+'))';};
 const positives=terms.groups.map(g=>'('+g.map(termMatch).join(' AND ')+')');
 if(positives.length)conditions.push('('+positives.join(' OR ')+')');
 for(const t of terms.excludes)conditions.push('NOT '+termMatch(t));
 const location=(p.get('location')||'').trim().slice(0,100);if(location)conditions.push("strpos(lower(coalesce(c.location,'')),lower("+add(location)+"::text))>0");
 for(const [key,op] of [['min','>='],['max','<=']]){const raw=p.get(key);if(raw===null||raw==='')continue;const n=Number(raw);if(!Number.isFinite(n)||n<0||n>80)throw new HttpError(400,'Experience must be between 0 and 80 years.');conditions.push('c.experience_years '+op+' '+add(n));}
 if(p.get('min')&&p.get('max')&&Number(p.get('min'))>Number(p.get('max')))throw new HttpError(400,'Minimum experience cannot exceed maximum.');
 return {where:conditions.join(' AND '),args};
}
export async function resumeSearch(actor:Actor,p:URLSearchParams,exportMode=false){
 const {where,args}=buildResumeSearch(actor,p);
 const page=Math.max(1,Math.min(10000,Math.floor(Number(p.get('page'))||1)));const limit=exportMode?10001:50;
 const count=await one<{total:number}>('SELECT count(*)::int total FROM candidates c WHERE '+where,args);
 const total=await one<{total:number}>('SELECT count(*)::int total FROM candidates c WHERE c.organization_id=$1 AND c.deleted_at IS NULL'+(actor.role==='admin'?'':' AND c.owner_id=$2'),actor.role==='admin'?[actor.organization_id]:[actor.organization_id,actor.id]);
 const rows=await sql("SELECT c.id,c.full_name,c.preferred_role,c.skills,c.location,c.experience_years,c.stage,u.full_name owner_name,r.id resume_id,r.original_filename,(length(trim(coalesce(r.extracted_text,'')))>=40) text_available FROM candidates c LEFT JOIN users u ON u.id=c.owner_id AND u.organization_id=c.organization_id LEFT JOIN LATERAL (SELECT id,original_filename,extracted_text FROM resume_versions WHERE organization_id=c.organization_id AND candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE "+where+" ORDER BY c.created_at DESC,c.id DESC LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),[...args,limit,exportMode?0:(page-1)*limit]);
 return {data:rows,total:total?.total||0,matched:count?.total||0,page,limit};
}
