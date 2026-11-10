'use client';

/**
 * Actual resume bytes for isolated demos. These files never leave this browser.
 * Candidate and resume metadata live in demo-client.ts; binary data is kept in
 * IndexedDB instead of localStorage to avoid its small string-only quota.
 */
const DATABASE='skillmint-demo-resume-files-v1';
const FILES='files';

function openDatabase():Promise<IDBDatabase> {
  if(typeof indexedDB==='undefined')return Promise.reject(new Error('Browser file storage is not available. Please enable site storage to save resumes.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(FILES))db.createObjectStore(FILES);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Unable to open browser resume storage. Check browser storage permissions.'));
    request.onblocked=()=>reject(new Error('Resume storage is blocked by another open tab. Close other SkillMint tabs and retry.'));
  });
}

async function transact<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore,done:(value:T)=>void)=>void):Promise<T> {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    let result:T;
    let settled=false;
    const tx=db.transaction(FILES,mode);
    tx.oncomplete=()=>{settled=true;db.close();resolve(result);};
    tx.onerror=()=>{settled=true;db.close();reject(new Error('Could not save or read the resume in browser storage. Check available storage space.'));};
    tx.onabort=()=>{if(!settled){db.close();reject(new Error('Resume file operation was cancelled by the browser.'));}};
    try {action(tx.objectStore(FILES),value=>{result=value;});}
    catch(error){tx.abort();if(!settled){settled=true;db.close();reject(error);}}
  });
}

export async function saveDemoResumeFile(versionId:string,file:File):Promise<void> {
  await transact<void>('readwrite',store=>{store.put(file,versionId);});
}

export async function loadDemoResumeFile(versionId:string):Promise<Blob|null> {
  return transact<Blob|null>('readonly',(store,done)=>{
    const req=store.get(versionId);
    req.onsuccess=()=>done(req.result instanceof Blob?req.result:null);
  });
}

export async function removeDemoResumeFiles(versionIds:string[]):Promise<void> {
  if(!versionIds.length)return;
  await transact<void>('readwrite',store=>{for(const versionId of versionIds)store.delete(versionId);});
}
