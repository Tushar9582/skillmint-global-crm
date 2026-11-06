import { demoRequest, isDemoClient } from './demo-client';

export async function requestJson<T=Record<string,unknown>>(url:string,init?:RequestInit):Promise<T> {
  if(isDemoClient() && url.startsWith('/api/v1/')) return demoRequest<T>(url,init);
  const response=await fetch(url,{cache:'no-store',...init,
    headers:{...(init?.body instanceof FormData?{}:{'Content-Type':'application/json'}),...init?.headers}});
  let payload:Record<string,unknown>={};
  try {payload=await response.json();} catch { /* a server error without JSON */ }
  if(!response.ok)throw new Error(String(payload.error||`Request failed (${response.status})`));
  return payload as T;
}

/** Downloads a server file; in demo mode the simulated API returns the content inline. */
export async function downloadFile(url:string,fallbackName:string):Promise<void> {
  let blob:Blob;let name=fallbackName;
  if(isDemoClient()&&url.startsWith('/api/v1/')) {
    const result=await demoRequest<{filename?:string;csv?:string;pdf?:string}>(url);
    name=result.filename||fallbackName;
    if(result.pdf){const bytes=Uint8Array.from(atob(result.pdf),c=>c.charCodeAt(0));blob=new Blob([bytes],{type:'application/pdf'});}
    else blob=new Blob([result.csv||''],{type:'text/csv;charset=utf-8'});
  } else {
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok){let message='Download failed';try{message=(await response.json()).error||message;}catch{/* not JSON */}throw new Error(message);}
    blob=await response.blob();
  }
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

export function formatDate(value:unknown,withTime=false):string {
  if(!value)return '—';
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat('en-IN',{
    timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
    ...(withTime?{hour:'2-digit',minute:'2-digit'}:{}),
  }).format(date);
}

export function toInputDate(value:unknown,dateOnly=false):string {
  if(!value)return '';
  if(dateOnly)return String(value).slice(0,10);
  const d=new Date(String(value));
  if(Number.isNaN(d.getTime()))return '';
  const local=new Date(d.getTime()+330*60000);
  return local.toISOString().slice(0,16);
}

export function friendly(value:unknown):string {
  if(value===null||value===undefined||value==='')return '—';
  if(Array.isArray(value))return value.join(', ');
  return String(value).replace(/_/g,' ').replace(/\b\w/g,x=>x.toUpperCase());
}
