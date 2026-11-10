import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDemoResume, demoRequest, saveDemoResumeCandidate } from '../src/lib/demo-client';
import { loadDemoResumeFile } from '../src/lib/demo-resume-storage';

// Minimal asynchronous IndexedDB adapter to exercise the browser-only demo
// workflow in Node without requiring a real database or network access.
test('demo resume bytes survive a new read, open with the candidate and are cleaned up on delete',async()=>{
  const previousEnv={nodeEnv:process.env.NODE_ENV,mode:process.env.NEXT_PUBLIC_DEMO_MODE};
  const previousStorage=Reflect.get(globalThis,'localStorage');
  const previousIndexedDB=Reflect.get(globalThis,'indexedDB');
  const previousWindow=Reflect.get(globalThis,'window');
  const data=new Map<string,Blob>();
  const kv=new Map<string,string>();
  let created=false;
  const database={
    objectStoreNames:{contains:()=>created},
    createObjectStore:()=>{created=true;},
    close:()=>{},
    transaction:()=>{
      const tx:Record<string,unknown>={};
      const finish=()=>queueMicrotask(()=>{(tx.oncomplete as (()=>void)|undefined)?.();});
      tx.objectStore=()=>({
        put:(value:Blob,key:string)=>{data.set(key,value);finish();},
        delete:(key:string)=>{data.delete(key);finish();},
        get:(key:string)=>{
          const req:Record<string,unknown>={};
          queueMicrotask(()=>{req.result=data.get(key);(req.onsuccess as (()=>void)|undefined)?.();finish();});
          return req;
        },
      });
      return tx;
    },
  };
  Reflect.set(globalThis,'indexedDB',{open:()=>{
    const req:Record<string,unknown>={};
    queueMicrotask(()=>{
      req.result=database;
      if(!created)(req.onupgradeneeded as (()=>void)|undefined)?.();
      (req.onsuccess as (()=>void)|undefined)?.();
    });
    return req;
  }});
  Reflect.set(globalThis,'localStorage',{getItem:(key:string)=>kv.get(key)??null,setItem:(key:string,value:string)=>{kv.set(key,value);}});
  Reflect.set(globalThis,'window',{});
  Reflect.set(process.env,'NODE_ENV','production');
  process.env.NEXT_PUBLIC_DEMO_MODE='true';
  try {
    const pdf=new File(['%PDF-1.4 resume content'],'candidate.pdf',{type:'application/pdf'});
    const createdLead=await saveDemoResumeCandidate({full_name:'Sam Test',email:'sam@example.test',skills:['Recruitment']},pdf,'hash-one','00000000-0000-4000-8000-000000000001');
    if(!('data' in createdLead))throw new Error('Candidate unexpectedly matched an existing lead');
    assert.equal(createdLead.created,true);
    const leadId=createdLead.data.candidate_id;
    const storedMetadata=JSON.parse(kv.get('skillmint-development-demo-v1')||'{}');
    assert.equal(storedMetadata.resumes?.length,1,'resume metadata should be saved with the candidate');
    assert.equal(storedMetadata.resumes[0].candidate_id,leadId,'resume must link to the correct candidate');
    const versions=await demoRequest<{data:Array<{id:string;candidate_id:string;original_filename:string}>}>(`/api/v1/resumes?candidate_id=${leadId}`);
    assert.equal(versions.data.length,1);
    assert.equal(versions.data[0].original_filename,'candidate.pdf');
    assert.equal(await (await loadDemoResumeFile(versions.data[0].id))?.text(),'%PDF-1.4 resume content');

    const repeated=await saveDemoResumeCandidate({full_name:'Sam Test'},pdf,'hash-one','00000000-0000-4000-8000-000000000001');
    if(!('duplicate' in repeated))throw new Error('Exact duplicate was allowed');
    assert.equal(repeated.duplicate,true);
    const second=new File(['second version'],'candidate-updated.docx');
    await attachDemoResume(leadId,second,'hash-two');
    const updated=await demoRequest<{data:Array<{id:string}>}>(`/api/v1/resumes?candidate_id=${leadId}`);
    assert.equal(updated.data.length,2);
    assert.equal(await (await loadDemoResumeFile(updated.data[0].id))?.text(),'second version');

    await demoRequest(`/api/v1/candidates/${leadId}`,{method:'DELETE'});
    assert.equal((await demoRequest<{data:unknown[]}>(`/api/v1/resumes?candidate_id=${leadId}`)).data.length,0);
    assert.equal(await loadDemoResumeFile(updated.data[0].id),null);
    assert.equal(await loadDemoResumeFile(updated.data[1].id),null);
  } finally {
    if(previousEnv.nodeEnv===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Reflect.set(process.env,'NODE_ENV',previousEnv.nodeEnv);
    if(previousEnv.mode===undefined)delete process.env.NEXT_PUBLIC_DEMO_MODE;else process.env.NEXT_PUBLIC_DEMO_MODE=previousEnv.mode;
    if(previousStorage===undefined)Reflect.deleteProperty(globalThis,'localStorage');else Reflect.set(globalThis,'localStorage',previousStorage);
    if(previousIndexedDB===undefined)Reflect.deleteProperty(globalThis,'indexedDB');else Reflect.set(globalThis,'indexedDB',previousIndexedDB);
    if(previousWindow===undefined)Reflect.deleteProperty(globalThis,'window');else Reflect.set(globalThis,'window',previousWindow);
  }
});
