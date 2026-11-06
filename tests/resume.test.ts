import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError, normalizeEmail, normalizePhone } from '../src/lib/auth';
import { parseResume, sha256, validateResume } from '../src/lib/resume';

test('resume parser extracts candidate identity, skills, work history and contact details', () => {
  const text=`CURRICULUM VITAE
Name: Aditi Sharma
Email: Aditi.Sharma@example.com
Phone: +91 9876543210
Current Location: Indore
Current Role: Recruitment Specialist
Experience: 4.5 years
Notice Period: 30 days
Skills: Recruitment, Talent Acquisition, Excel, Communication and HR Operations.
I have worked across corporate hiring, sourcing, employee screening and onboarding.`;
  const parsed=parseResume(text,'aditi-sharma.pdf');
  assert.equal(parsed.full_name,'Aditi Sharma');
  assert.equal(parsed.email,'Aditi.Sharma@example.com');
  assert.equal(parsed.normalized_email,'aditi.sharma@example.com');
  assert.equal(parsed.normalized_phone,'9876543210');
  assert.equal(parsed.location,'Indore');
  assert.equal(parsed.experience_years,4.5);
  assert.equal(parsed.notice_period,'30 days');
  assert.equal(parsed.preferred_role,'Recruitment Specialist');
  assert.ok(parsed.skills.includes('Talent Acquisition'));
  assert.equal(parsed.parse_status,'ready');
});

test('image-only resumes are flagged for manual review', () => {
  const parsed=parseResume('','resume_123.pdf');
  assert.equal(parsed.parse_status,'needs_review');
  assert.equal(parsed.email,null);
  assert.equal(parsed.full_name,'resume 123');
});

test('normalize email and Indian phone identities consistently', () => {
  assert.equal(normalizeEmail('  Aditi+Jobs@Example.COM  '),'aditi+jobs@example.com');
  assert.equal(normalizePhone('+91-98765-43210'),'9876543210');
  assert.equal(normalizePhone('9876543210'),'9876543210');
});

test('resume signature validation rejects invalid or oversized data', () => {
  const fakePdf=Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(70)]);
  const fakeDocx=Buffer.concat([Buffer.from('PK'),Buffer.alloc(70)]);
  assert.equal(validateResume('profile.pdf',fakePdf),'application/pdf');
  assert.equal(validateResume('profile.docx',fakeDocx),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.throws(()=>validateResume('profile.pdf',Buffer.alloc(90)),HttpError);
  assert.throws(()=>validateResume('profile.exe',fakePdf),HttpError);
  assert.throws(()=>validateResume('profile.pdf',Buffer.alloc(11*1024*1024)),HttpError);
});

test('identical file bytes produce identical SHA-256 identity hashes', () => {
  const first=sha256(Buffer.from('example resume bytes'));
  const same=sha256(Buffer.from('example resume bytes'));
  const other=sha256(Buffer.from('a different version'));
  assert.equal(first,same);
  assert.notEqual(first,other);
  assert.match(first,/^[a-f0-9]{64}$/);
});
