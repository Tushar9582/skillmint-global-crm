import * as pdfjs from './resume-parser-assets/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./resume-parser-assets/pdf.worker.mjs',import.meta.url).href;
const assets=new URL('./resume-parser-assets/',import.meta.url).href;
let mammothPromise;
function loadMammoth(){
  if(!mammothPromise)mammothPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.src=assets+'mammoth.js';
    s.onload=()=>window.mammoth?resolve(window.mammoth):reject(new Error('DOCX reader unavailable'));
    s.onerror=()=>{mammothPromise=undefined;reject(new Error('DOCX reader failed to load'));};
    document.head.appendChild(s);
  });
  return mammothPromise;
}
window.skillmintReadResume=async(file)=>{
  const bytes=await file.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const signature=new Uint8Array(bytes,0,Math.min(bytes.byteLength,5));
  let text='';
  if(/\.pdf$/i.test(file.name)){
    if(String.fromCharCode(...signature)!=='%PDF-')throw new Error('Invalid PDF file');
    const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,useSystemFonts:true,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'});
    try{
      const doc=await task.promise;
      if(doc.numPages>100)throw new Error('Resume exceeds 100 pages');
      for(let i=1;i<=doc.numPages&&text.length<150000;i++){
        const page=await doc.getPage(i);
        const content=await page.getTextContent();
        text+=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('')+'\n';
        page.cleanup();
      }
    }finally{await task.destroy();}
  }else if(/\.docx$/i.test(file.name)){
    if(signature[0]!==80||signature[1]!==75)throw new Error('Invalid DOCX file');
    const mammoth=await loadMammoth();
    text=(await mammoth.extractRawText({arrayBuffer:bytes})).value;
  }else throw new Error('Only PDF or DOCX resumes are supported');
  return {text:text.slice(0,150000),sha256:hash};
};
