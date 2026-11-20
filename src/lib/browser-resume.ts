type BrowserReader=(file:File)=>Promise<{text:string;sha256:string}>;
let loading:Promise<BrowserReader>|undefined;
export async function readBrowserResume(file:File){
  const w=window as Window&{skillmintReadResume?:BrowserReader};
  if(!w.skillmintReadResume){
    if(!loading)loading=new Promise<BrowserReader>((resolve,reject)=>{
      const s=document.createElement('script');s.type='module';s.src='/resume-browser.mjs';
      s.onload=()=>w.skillmintReadResume?resolve(w.skillmintReadResume):reject(new Error('Browser resume reader unavailable'));
      s.onerror=()=>reject(new Error('Browser resume reader could not load'));
      document.head.appendChild(s);
    }).catch(error=>{loading=undefined;throw error;});
    await loading;
  }
  if(!w.skillmintReadResume)throw new Error('Browser resume reader unavailable');
  return w.skillmintReadResume(file);
}
