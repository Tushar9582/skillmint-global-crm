import {api,json} from '@/lib/http';
import {ensureAdmin,HttpError} from '@/lib/auth';
import {resumeSearch} from '@/lib/resume-search';
function cell(value:unknown){let s=Array.isArray(value)?value.join(', '):String(value??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export const GET=api(async(request,actor)=>{
 const p=request.nextUrl.searchParams,exportMode=p.get('export')==='1';
 if(exportMode)ensureAdmin(actor);
 const result=await resumeSearch(actor,p,exportMode);
 if(!exportMode)return json(result);
 if(result.matched>10000)throw new HttpError(400,'Narrow your filters to export up to 10,000 candidates.');
 const keys=['full_name','preferred_role','skills','location','experience_years','stage','owner_name','original_filename'];
 return new Response('\uFEFF'+[keys.map(cell).join(','),...result.data.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="hrdiary-resume-search.csv"','Cache-Control':'no-store'}});
});
