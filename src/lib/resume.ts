import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { HttpError } from './auth';

export { parseResume, type ExtractedCandidate } from './resume-fields';

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
      // Avoid the v1.1.1 package entry point's test-file/debug side effect in serverless ESM.
      const pdfParse=(await import('pdf-parse/lib/pdf-parse.js')).default;
      const parsed=await pdfParse(bytes);
      return parsed.text.slice(0,150000);
    }
    const mammoth=await import('mammoth');
    const parsed=await mammoth.extractRawText({buffer:bytes});
    return parsed.value.slice(0,150000);
  } catch(error) {
    // Do not log resume contents, filenames or parser messages containing document data.
    console.error('[resume] extraction failed', {format:mime==='application/pdf'?'pdf':'docx',errorType:error instanceof Error?error.name:'unknown',code:error && typeof error==='object' && 'code' in error && typeof error.code==='string' && /^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:undefined});
    throw new HttpError(422,'Document parser could not read this file. Try a text-based PDF or DOCX, or enter candidate details manually.');
  }
}

