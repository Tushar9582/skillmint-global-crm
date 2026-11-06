import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { normalizeEmail, normalizePhone, HttpError } from './auth';

export interface ExtractedCandidate {
  full_name: string;
  email: string | null;
  phone: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  location: string | null;
  skills: string[];
  experience_years: number | null;
  notice_period: string | null;
  preferred_role: string | null;
  current_designation: string | null;
  education: string | null;
  current_company: string | null;
  expected_ctc: number | null;
  parse_status: 'ready' | 'needs_review';
}

const SKILL_TERMS=[
  'JavaScript','TypeScript','React','Next.js','Node.js','Python','Java','Spring Boot','AWS',
  'Azure','Docker','Kubernetes','PostgreSQL','MongoDB','MySQL','SQL','Excel','Power BI',
  'Salesforce','Recruitment','Talent Acquisition','Sourcing','HR Operations',
  'Communication','Customer Support','Digital Marketing','Accounting','SAP','Linux',
  'C++','C#','.NET','Angular','Vue','Django','FastAPI','Machine Learning',
];

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function validateResume(name:string,bytes:Buffer): 'application/pdf'|'application/vnd.openxmlformats-officedocument.wordprocessingml.document' {
  if(bytes.length<50 || bytes.length>10*1024*1024) throw new HttpError(400,'Resume must be between 50 bytes and 10 MB');
  const ext=extname(name).toLowerCase();
  if(ext==='.pdf' && bytes.subarray(0,5).toString('ascii')==='%PDF-') return 'application/pdf';
  if(ext==='.docx' && bytes.subarray(0,2).toString('ascii')==='PK') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  throw new HttpError(400,'Only valid PDF and DOCX resumes are accepted');
}

export async function extractText(bytes:Buffer,mime:string): Promise<string> {
  try {
    if(mime==='application/pdf') {
      const pdfParse=(await import('pdf-parse')).default;
      const parsed=await pdfParse(bytes);
      return parsed.text.slice(0,150000);
    }
    const mammoth=await import('mammoth');
    const parsed=await mammoth.extractRawText({buffer:bytes});
    return parsed.value.slice(0,150000);
  } catch {
    return ''; // Scanned PDF, malformed or unsupported layout -> manual correction.
  }
}

export function parseResume(text:string,filename:string): ExtractedCandidate {
  const clean=text.replace(/\r/g,'').replace(/\u00a0/g,' ');
  const lines=clean.split('\n').map(line=>line.trim()).filter(Boolean);
  const email=clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
  const rawPhones=clean.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g) || [];
  const phone=rawPhones[0]?.replace(/[\s-]/g,'') || null;
  const explicitName=clean.match(/^(?:full\s*name|candidate\s*name|name)\s*[:\-]\s*([A-Za-z][A-Za-z .'-]{3,65})$/im)?.[1]?.trim();
  const titleBlackList=/^(curriculum vitae|resume|cv|professional summary|profile|contact|email|phone|objective|about me)$/i;
  const name=explicitName || lines.slice(0,12).find(line=>/^[A-Za-z][A-Za-z .'-]{3,55}$/.test(line)
    && line.trim().split(/\s+/).length<=5 && !titleBlackList.test(line))
    || filename.replace(/\.(pdf|docx)$/i,'').replace(/[_-]+/g,' ').slice(0,80);
  const experience=/\b(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b/i.exec(clean);
  const notice=/(?:notice\s*period|availability)\s*[:\-]?\s*([^\n,;]{3,40})/i.exec(clean);
  const city=/(?:current\s*location|location|city)\s*[:\-]\s*([^\n,;]{2,50})/i.exec(clean);
  const role=/(?:designation|current\s*role|job\s*title|role)\s*[:\-]\s*([^\n,;]{3,70})/i.exec(clean);
  const preferred=/(?:preferred\s*(?:job\s*)?role|seeking|looking\s+for)\s*[:\-]?\s*([^\n,;]{3,70})/i.exec(clean);
  const company=/(?:current\s*company|employer|organization)\s*[:\-]\s*([^\n,;]{2,80})/i.exec(clean);
  const education=/(?:education|qualification|academic\s*(?:background|qualification))\s*[:\-]\s*([^\n]{3,140})/i.exec(clean)
    || clean.match(/\b(?:B\.?Tech|B\.E\.?|M\.?Tech|M\.E\.?|MBA|BCA|MCA|B\.Sc|M\.Sc|B\.Com|M\.Com)\b[^\n]{0,100}/i);
  const ctc=/(?:expected\s*)?ctc\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(lpa|lakhs?|k)?/i.exec(clean);
  const skills=SKILL_TERMS.filter(term => {
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`,'i').test(clean);
  });
  return {
    full_name:name || 'Candidate - Needs Review',
    email, phone,
    normalized_email:normalizeEmail(email),
    normalized_phone:normalizePhone(phone),
    location:city?.[1]?.trim() || null,
    skills,
    experience_years:experience ? Number(experience[1]) : null,
    notice_period:notice?.[1]?.trim() || null,
    preferred_role:preferred?.[1]?.trim() || role?.[1]?.trim() || null,
    current_designation:role?.[1]?.trim() || null,
    education:education?.[1]?.trim() || null,
    current_company:company?.[1]?.trim() || null,
    expected_ctc:ctc ? Number(ctc[1])*(ctc[2]?.toLowerCase().startsWith('l')?100000:1) : null,
    parse_status: email && name && text.trim().length>80 ? 'ready':'needs_review',
  };
}
