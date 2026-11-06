import { api } from '@/lib/http';
import { ensureAdmin, HttpError } from '@/lib/auth';
import { CATALOG } from '@/lib/catalog';
import { listRecords } from '@/lib/records';

function csvCell(value:unknown):string {
  let text=Array.isArray(value)?value.join(', '):value===null||value===undefined?'':String(value);
  if(/^[=+@\-\t\r]/.test(text)) text=`'${text}`; // Avoid formula execution when opened in Excel.
  return `"${text.replace(/"/g,'""')}"`;
}

export const GET=api(async(request,actor)=>{
  ensureAdmin(actor);
  const resource=request.nextUrl.searchParams.get('resource')||'';
  const def=CATALOG[resource];
  if(!def) throw new HttpError(400,'Invalid export type');
  const rows=await listRecords(actor,resource,5000,0);
  const fields=['id',...def.fields.map(field=>field.name),'created_at'];
  const csv=[fields.map(csvCell).join(','),...rows.map(row=>fields.map(k=>csvCell(row[k])).join(','))].join('\r\n');
  return new Response('\uFEFF'+csv,{headers:{
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':`attachment; filename="skillmint-${resource}.csv"`,
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
  }});
});
