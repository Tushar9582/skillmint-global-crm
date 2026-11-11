import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateResumeFields, createResumeDraft, isResumeDraft, resumeLines,
  resumeSkills, safeResumeUrl, starterResumeSummary } from '../src/lib/resume-builder';

test('new resume drafts are editable, separate, and start without fabricated candidate facts',()=>{
  const first=createResumeDraft(),second=createResumeDraft();
  assert.notEqual(first.id,second.id);
  assert.equal(first.fullName,'');
  assert.equal(first.summary,'');
  assert.equal(first.experience.length,0);
  assert.equal(first.template,'executive');
  assert.equal(isResumeDraft(first),true);
});

test('resume preview parses actual skills and bullet lines without inventing content',()=>{
  assert.deepEqual(resumeSkills('React, TypeScript\nExcel,, SQL'),['React','TypeScript','Excel','SQL']);
  assert.deepEqual(resumeLines('• Coordinated interviews\n- Reviewed applications\n* Prepared reports\n'),
    ['Coordinated interviews','Reviewed applications','Prepared reports']);
  assert.deepEqual(resumeLines(''),[]);
});

test('candidate import uses real lead fields and handles array skills',()=>{
  const fields=candidateResumeFields({id:'candidate-1',full_name:'Asha Verma',email:'asha@example.com',
    phone:'9876543210',location:'Pune',preferred_role:'Recruiter',skills:['Sourcing','Excel']});
  assert.equal(fields.candidateId,'candidate-1');
  assert.equal(fields.fullName,'Asha Verma');
  assert.equal(fields.professionalTitle,'Recruiter');
  assert.equal(fields.skills,'Sourcing, Excel');
});

test('offline summary template only uses supplied job title and skills',()=>{
  const value=starterResumeSummary({professionalTitle:'Frontend Developer',skills:'React, TypeScript'});
  assert.match(value,/Frontend Developer/);
  assert.match(value,/React, TypeScript/);
  assert.doesNotMatch(value,/years|million|increased|achieved/i);
  assert.equal(starterResumeSummary({professionalTitle:'',skills:''}),'');
});

test('resume links permit only safe web URLs',()=>{
  assert.equal(safeResumeUrl('linkedin.com/in/asha'),'https://linkedin.com/in/asha');
  assert.equal(safeResumeUrl('https://example.com/portfolio'),'https://example.com/portfolio');
  assert.equal(safeResumeUrl('javascript:alert(1)'),null);
  assert.equal(safeResumeUrl(''),null);
});

test('malformed saved drafts are rejected before rendering',()=>{
  const draft=createResumeDraft();
  assert.equal(isResumeDraft({...draft,experience:[{id:'bad',role:'Broken'}]}),false);
  assert.equal(isResumeDraft({...draft,template:'untrusted'}),false);
  assert.equal(isResumeDraft(null),false);
});
