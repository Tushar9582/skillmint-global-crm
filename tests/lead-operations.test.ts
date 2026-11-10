import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAssignmentRange, parseProgressPeriod } from '../src/lib/lead-operations';
import { demoRequest } from '../src/lib/demo-client';

test('range validation rejects reversed, oversized or non-integer assignments',()=>{
  assert.deepEqual(parseAssignmentRange({from:21,to:70,search:' java ',stage:'new'}),
    {from:21,to:70,search:'java',stage:'new'});
  for(const value of [{from:0,to:2},{from:5,to:3},{from:1,to:201},{from:1.4,to:3},{from:1,to:10001}])
    assert.throws(()=>parseAssignmentRange(value));
});

test('India date boundaries are inclusive by day and limited to 91 days',()=>{
  const period=parseProgressPeriod('2026-11-08','2026-11-10');
  assert.equal(period.startIso,'2026-11-07T18:30:00.000Z');
  assert.equal(period.endExclusiveIso,'2026-11-10T18:30:00.000Z');
  assert.throws(()=>parseProgressPeriod('2026-02-30','2026-03-01'));
  assert.throws(()=>parseProgressPeriod('2026-11-10','2026-11-09'));
  assert.throws(()=>parseProgressPeriod('2026-01-01','2026-11-10'));
});

test('demo admin assigns by filtered row range, records owner and stage history, and tracks meetings',async()=>{
  const previousWindow=Reflect.get(globalThis,'window');
  const previousStorage=Reflect.get(globalThis,'localStorage');
  const memory=new Map<string,string>();
  Reflect.set(globalThis,'window',{});
  Reflect.set(globalThis,'localStorage',{
    getItem:(key:string)=>memory.get(key)??null,
    setItem:(key:string,value:string)=>{memory.set(key,value);},
  });
  try{
    for(let i=1;i<=5;i++)await demoRequest('/api/v1/candidates',{method:'POST',
      body:JSON.stringify({full_name:`Range Test ${i}`,email:`range-${i}@example.test`,stage:'new'})});
    const first=await demoRequest<{data:Array<{id:string;full_name:string;owner_id:string}>}>(
      '/api/v1/candidates?stage=new&limit=100');
    const matching=first.data;
    assert.equal(matching.length,5);
    assert.equal((await demoRequest<{data:{total:number}}>(
      '/api/v1/assignments/bulk?resource=candidates&stage=new')).data.total,5);
    const recruiterA='00000000-0000-4000-8000-000000000002';
    const recruiterB='00000000-0000-4000-8000-000000000003';
    const allocation=await demoRequest<{data:{requested:number;changed:number;recipient:string}}>(
      '/api/v1/assignments/bulk',{method:'POST',body:JSON.stringify({resource:'candidates',to_owner:recruiterA,
        range:{from:2,to:4,stage:'new',search:''},reason:'Test batch assignment'})});
    assert.deepEqual({requested:allocation.data.requested,changed:allocation.data.changed},
      {requested:3,changed:3});
    assert.equal(allocation.data.recipient,'Demo Recruiter A');
    const current=(await demoRequest<{data:Array<{id:string;owner_id:string}>}>(
      '/api/v1/candidates?stage=new&limit=100')).data;
    assert.deepEqual(current.filter(row=>row.owner_id===recruiterA).map(row=>row.id).sort(),
      matching.slice(1,4).map(row=>row.id).sort());

    await demoRequest('/api/v1/assignments/bulk',{method:'POST',body:JSON.stringify({resource:'candidates',
      to_owner:recruiterB,ids:[matching[0].id]})});
    assert.rejects(()=>demoRequest('/api/v1/assignments/bulk',{method:'POST',body:JSON.stringify({resource:'candidates',
      to_owner:recruiterA,range:{from:4,to:6,stage:'new'}})}),/insufficient matching leads/i);

    const leadId=matching[1].id;
    await demoRequest(`/api/v1/candidates/${leadId}`,{method:'PATCH',body:JSON.stringify({stage:'screened'})});
    const next=new Date(Date.now()+86400000).toISOString();
    await demoRequest('/api/v1/activities',{method:'POST',body:JSON.stringify({target_type:'candidates',target_id:leadId,
      channel:'meeting',outcome:'scheduled',notes:'Technical discussion',next_due_at:next})});
    const timeline=await demoRequest<{data:{stages:Array<{new_stage:string}>;assignments:Array<{to_name:string}>;
      followups:Array<{owner_id:string;channel:string}>}}>(`/api/v1/lead-timeline?resource=candidates&id=${leadId}`);
    assert.equal(timeline.data.stages[0].new_stage,'screened');
    assert.equal(timeline.data.assignments[0].to_name,'Demo Recruiter A');
    assert.equal(timeline.data.followups[0].owner_id,recruiterA,'Scheduled meeting follows lead owner');
    assert.equal(timeline.data.followups[0].channel,'meeting');

    const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
    const progress=await demoRequest<{data:{employees:Array<{id:string;candidates:number;activities:number;meetings:number;stage_updates:number}>}}>(
      `/api/v1/lead-progress?from=${today}&to=${today}`);
    const a=progress.data.employees.find(person=>person.id===recruiterA);
    const administrator=progress.data.employees.find(person=>person.id==='00000000-0000-4000-8000-000000000001');
    assert.equal(a?.candidates,3);
    assert.equal(administrator?.meetings,1);
    assert.ok((administrator?.stage_updates||0)>=1);
  }finally{
    if(previousWindow===undefined)Reflect.deleteProperty(globalThis,'window');else Reflect.set(globalThis,'window',previousWindow);
    if(previousStorage===undefined)Reflect.deleteProperty(globalThis,'localStorage');else Reflect.set(globalThis,'localStorage',previousStorage);
  }
});
