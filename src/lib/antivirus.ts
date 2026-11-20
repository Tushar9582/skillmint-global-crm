import net from 'node:net';
import { createHash } from 'node:crypto';
import { HttpError } from './auth';

// ClamAV clamd INSTREAM protocol. In production, uploads fail closed if no
// scanner is configured. This prevents uploaded documents from skipping scanning.
export async function scanResume(data:Buffer):Promise<void> {
  const provider=process.env.ANTIVIRUS_PROVIDER||'clamav';
  if(provider==='virustotal') return scanVirusTotalFixture(data);
  if(provider!=='clamav') throw new HttpError(503,'Unknown antivirus provider');
  const host=process.env.CLAMAV_HOST;
  const port=Number(process.env.CLAMAV_PORT || 3310);
  if(!host) {
    if(process.env.NODE_ENV==='production') throw new HttpError(503,'Resume antivirus scanner is not configured');
    return;
  }
  await new Promise<void>((resolve,reject)=>{
    let result='';
    let settled=false;
    const socket=net.createConnection({host,port});
    const done=(err?:Error)=>{
      if(settled)return;
      settled=true;
      socket.destroy();
      if(err)reject(err);else resolve();
    };
    socket.setTimeout(25000,()=>done(new HttpError(503,'Antivirus scanner timeout')));
    socket.once('error',()=>done(new HttpError(503,'Antivirus scanner unavailable')));
    socket.on('connect',()=>{
      socket.write('zINSTREAM\0');
      for(let offset=0;offset<data.length;offset+=65536){
        const chunk=data.subarray(offset,offset+65536);
        const size=Buffer.allocUnsafe(4);
        size.writeUInt32BE(chunk.length,0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data',buffer=>{
      result+=buffer.toString('utf8');
      if(result.includes('\0') || result.includes('\n')) {
        if(result.includes('FOUND')) done(new HttpError(400,'Virus detected in uploaded document'));
        else if(result.includes('OK')) done();
        else done(new HttpError(503,'Antivirus scan did not pass'));
      }
    });
    socket.on('end',()=>{
      if(!settled)done(new HttpError(503,'Antivirus scanner closed unexpectedly'));
    });
  });
}

// Isolated non-commercial testing only. Only explicitly allowlisted synthetic
// fixtures may leave the CRM; never submit actual candidate documents.
async function scanVirusTotalFixture(data:Buffer):Promise<void> {
  const key=process.env.VIRUSTOTAL_API_KEY;
  const hash=createHash('sha256').update(data).digest('hex');
  const fixtures=(process.env.VIRUSTOTAL_TEST_FIXTURE_SHA256||'').split(',').map(s=>s.trim().toLowerCase());
  if(process.env.VIRUSTOTAL_TEST_ONLY!=='true' || !key || !fixtures.includes(hash)) {
    throw new HttpError(503,'VirusTotal is restricted to explicitly approved synthetic test fixtures');
  }
  const request=async(path:string,init:RequestInit={})=>{
    try {
      const response=await fetch('https://www.virustotal.com/api/v3/'+path,{
        ...init,headers:{'x-apikey':key},signal:AbortSignal.timeout(8000),redirect:'error'
      });
      if(response.status===429) throw new HttpError(503,'VirusTotal test quota exceeded; retry later');
      if(!response.ok) throw new HttpError(503,'VirusTotal test service unavailable');
      return await response.json();
    }catch(error){
      if(error instanceof HttpError) throw error;
      throw new HttpError(503,'VirusTotal test service unavailable');
    }
  };
  let report:Response;
  try {
    report=await fetch('https://www.virustotal.com/api/v3/files/'+hash,{
      headers:{'x-apikey':key},signal:AbortSignal.timeout(8000),redirect:'error'
    });
  }catch{throw new HttpError(503,'VirusTotal test service unavailable');}
  if(report.ok){
    const existing=await report.json();
    return checkVirusTotalStats(existing?.data?.attributes?.last_analysis_stats);
  }
  if(report.status!==404)throw new HttpError(503,'VirusTotal report lookup failed; retry later');
  const form=new FormData();
  form.append('file',new Blob([new Uint8Array(data)]),'synthetic-test-fixture');
  const submitted=await request('files',{method:'POST',body:form});
  const id=submitted?.data?.id;
  if(typeof id!=='string'||!id) throw new HttpError(503,'VirusTotal returned no analysis ID');
  const result=await request('analyses/'+encodeURIComponent(id));
  const attrs=result?.data?.attributes;
  if(attrs?.status!=='completed') throw new HttpError(503,'VirusTotal analysis pending; retry after the report is available');
  checkVirusTotalStats(attrs?.stats);
}

function checkVirusTotalStats(stats:Record<string,unknown>|undefined):void {
  if(!stats||typeof stats.malicious!=='number'||typeof stats.suspicious!=='number'||typeof stats.undetected!=='number')
    throw new HttpError(503,'VirusTotal report incomplete');
  if(stats.malicious>0||stats.suspicious>0)throw new HttpError(400,'Suspicious or malicious test document detected');
  if(stats.undetected<=0)throw new HttpError(503,'VirusTotal report has no undetected results');
}
