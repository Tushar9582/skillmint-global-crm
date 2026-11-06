import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin, HttpError, isDevDemoMode } from '@/lib/auth';
import { extractText, parseResume, sha256, validateResume } from '@/lib/resume';

/** Local-only parser used by the browser demo store. It deliberately has no DB or storage dependency. */
export async function POST(request:NextRequest) {
  try {
    if(!isDevDemoMode()) return NextResponse.json({error:'Not found'},{status:404});
    assertSameOrigin(request);
    const form=await request.formData();
    const file=form.get('file');
    if(!(file instanceof File)) throw new HttpError(400,'Please select a PDF or DOCX resume');
    const bytes=Buffer.from(await file.arrayBuffer());
    const mime=validateResume(file.name,bytes);
    const text=await extractText(bytes,mime);
    if(text.trim().length<40) return NextResponse.json({error:'Unable to extract text from this resume. It may be scanned/image-based and requires OCR or manual review.',code:'OCR_REQUIRED'},{status:422});
    return NextResponse.json({parsed:parseResume(text,file.name),sha256:sha256(bytes),text_length:text.trim().length,filename:file.name});
  } catch(error) {
    const message=error instanceof HttpError?error.message:'Unable to read this resume';
    return NextResponse.json({error:message},{status:error instanceof HttpError?error.status:400});
  }
}
