import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { api, json } from '@/lib/http';
import { ensureAdmin, HttpError, normalizeEmail, normalizePhone } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { one, sql, transaction } from '@/lib/db';

type InputRow=Record<string,string>;
const fieldAliases:Record<string,string>={
  'company':'company_name','company name':'company_name','employer':'company_name',
  'name':'full_name','candidate name':'full_name','full name':'full_name',
  'contact':'contact_name','contact person':'contact_name','mobile':'phone',
  'mobile number':'phone','telephone':'phone','city':'location',
  'experience':'experience_years','experience (years)':'experience_years',
  'expected salary':'expected_ctc','expected ctc':'expected_ctc',
};

function canonical(label:string):string {
  const lower=label.trim().toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ');
  return fieldAliases[lower]||lower.replace(/\s+/g,'_');
}

async function parseFile(name:string,buffer:Buffer):Promise<InputRow[]> {
  if(buffer.length>4*1024*1024) throw new HttpError(400,'Import limit: 4MB');
  if(name.toLowerCase().endsWith('.csv')) {
    const data=parse(buffer.toString('utf8'),{columns:true,skip_empty_lines:true,relax_quotes:false,bom:true}) as InputRow[];
    return data.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[canonical(k),String(v||'').trim()])));
  }
  if(name.toLowerCase().endsWith('.xlsx')) {
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const worksheet=workbook.worksheets[0];
    if(!worksheet) throw new HttpError(400,'Workbook contains no sheet');
    const header=worksheet.getRow(1).values as Array<unknown>;
    const fields=header.map(v=>canonical(String(v||'')));
    const data:InputRow[]=[];
    worksheet.eachRow((row,index)=>{
      if(index===1) return;
      const item:InputRow={};
      row.eachCell((cell,cellIndex)=>{
        const key=fields[cellIndex]||'';
        if(key)item[key]=cell.text.trim();
      });
      if(Object.values(item).some(Boolean))data.push(item);
    });
    return data;
  }
  throw new HttpError(400,'Upload .csv or .xlsx file');
}

function toCandidate(row:InputRow) {
  return {
    full_name:row.full_name||'',
    email:normalizeEmail(row.email),phone:row.phone||null,
    normalized_email:normalizeEmail(row.email),normalized_phone:normalizePhone(row.phone),
    location:row.location||row.city||null,
    skills:(row.skills||'').split(',').map(x=>x.trim()).filter(Boolean),
    experience_years:row.experience_years && Number.isFinite(Number(row.experience_years))?Number(row.experience_years):null,
    expected_ctc:row.expected_ctc&&Number.isFinite(Number(row.expected_ctc))?Number(row.expected_ctc):null,
  };
}

export const POST=api(async(request,actor)=>{
  ensureAdmin(actor);
  const form=await request.formData();
  const file=form.get('file');
  const kind=String(form.get('kind')||'company-leads');
  const dryRun=String(form.get('dry_run')||'false')==='true';
  if(!(file instanceof File) || !['company-leads','candidates'].includes(kind)) throw new HttpError(400,'Select import file and type');
  const bytes=Buffer.from(await file.arrayBuffer());
  const rows=await parseFile(file.name,bytes);
  if(rows.length>500) throw new HttpError(400,'Import up to 500 rows per batch');
  const errors=rows.flatMap((r,index)=>{
    const required=kind==='company-leads'?'company_name':'full_name';
    return r[required]?[]:[{row:index+2,message:`Missing ${required}`}];
  });
  if(dryRun) return json({preview:rows.slice(0,15),count:rows.length,errors,mapped_fields:Object.keys(rows[0]||{})});
  const hash=createHash('sha256').update(bytes).digest('hex');
  const result=await transaction(async client=>{
    const earlier=await one('SELECT id FROM import_batches WHERE organization_id=$1 AND kind=$2 AND content_hash=$3',
      [actor.organization_id,kind,hash],client);
    if(earlier) throw new HttpError(409,'This exact spreadsheet was already imported');
    const batch=await one<{id:string}>(
      `INSERT INTO import_batches(organization_id,created_by,kind,content_hash)
       VALUES($1,$2,$3,$4) RETURNING id`,[actor.organization_id,actor.id,kind,hash],client);
    let inserted=0,skipped=0;
    const issues=[...errors];
    for(let i=0;i<rows.length;i++) {
      const r=rows[i];
      if(issues.some(x=>x.row===i+2)) {skipped++;continue;}
      if(kind==='candidates') {
        const candidate=toCandidate(r);
        const matched=(candidate.normalized_email||candidate.normalized_phone)?await one(
          `SELECT id FROM candidates WHERE organization_id=$1 AND
           (($2::text IS NOT NULL AND normalized_email=$2) OR ($3::text IS NOT NULL AND normalized_phone=$3)) LIMIT 1`,
          [actor.organization_id,candidate.normalized_email,candidate.normalized_phone],client):null;
        if(matched) {skipped++;issues.push({row:i+2,message:'Candidate identity already exists'});continue;}
        await sql(`INSERT INTO candidates(organization_id,full_name,email,phone,normalized_email,normalized_phone,
                   location,skills,experience_years,expected_ctc,source,owner_id,created_by)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'import',$11,$12)`,
          [actor.organization_id,candidate.full_name,candidate.email,candidate.phone,candidate.normalized_email,
           candidate.normalized_phone,candidate.location,candidate.skills,candidate.experience_years,
           candidate.expected_ctc,actor.id,actor.id],client);
      } else {
        const email=normalizeEmail(r.email);
        const exists=email?await one('SELECT id FROM company_leads WHERE organization_id=$1 AND lower(company_name)=lower($2) AND email=$3',
          [actor.organization_id,r.company_name,email],client):null;
        if(exists) {skipped++;issues.push({row:i+2,message:'Matching company/contact already exists'});continue;}
        await sql(`INSERT INTO company_leads(organization_id,company_name,contact_name,email,phone,city,
                   industry,source,owner_id,created_by)
                   VALUES($1,$2,$3,$4,$5,$6,$7,'import',$8,$9)`,
          [actor.organization_id,r.company_name,r.contact_name||null,email,r.phone||null,
           r.city||r.location||null,r.industry||null,actor.id,actor.id],client);
      }
      inserted++;
    }
    await sql(`UPDATE import_batches SET inserted=$1,skipped=$2,errors=$3::jsonb WHERE id=$4`,
      [inserted,skipped,JSON.stringify(issues),batch!.id],client);
    await audit(actor,'spreadsheet_import','import_batches',batch!.id,{kind,inserted,skipped},client);
    return {id:batch!.id,inserted,skipped,errors:issues};
  });
  return json({data:result});
});
