import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { HttpError } from './auth';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type Driver='local'|'spaces'|'s3'|'supabase';
const driver=(process.env.STORAGE_DRIVER || 'local') as Driver;
const bucket=process.env.STORAGE_BUCKET || 'skillmint-resumes';

export function requirePersistentResumeStorage(){
 if(process.env.NODE_ENV!=='production')return;
 if(!['spaces','s3','supabase'].includes(driver))throw new HttpError(503,'Cloud resume storage is not configured. No file has been saved. Contact your administrator.');
 if(driver==='supabase'&&(!process.env.STORAGE_ENDPOINT||!process.env.STORAGE_ACCESS_KEY||!process.env.STORAGE_SECRET_KEY))throw new HttpError(503,'Supabase Storage credentials are missing. No file has been saved.');
}
export async function resumeStorageReady():Promise<boolean>{
 try{requirePersistentResumeStorage();if(driver==='local')return false;await s3().send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:1}),{abortSignal:AbortSignal.timeout(5000)});return true;}catch{return false;}
}
function s3(): S3Client {
  if(!['spaces','s3','supabase'].includes(driver)) throw new Error('Cloud object storage is not configured');
  if(driver==='supabase' && (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_ACCESS_KEY || !process.env.STORAGE_SECRET_KEY))
    throw new Error('Supabase S3 endpoint and server-side credentials are required');
  return new S3Client({
    region:process.env.STORAGE_REGION || 'ap-south-1',
    endpoint:process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle:driver==='spaces'||driver==='supabase',
    credentials: process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY ? {
      accessKeyId:process.env.STORAGE_ACCESS_KEY,
      secretAccessKey:process.env.STORAGE_SECRET_KEY,
    } : undefined,
  });
}

function safeFile(key: string): string {
  if(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[^\/]+$/.test(key)) throw new Error('Invalid object key');
  return resolve(process.cwd(),'data','uploads',key);
}

export async function storeResume(key: string,content:Buffer,mime: string): Promise<void> {
  requirePersistentResumeStorage();
  if(driver==='local') {
    if(process.env.NODE_ENV==='production') throw new Error('Local resume storage must not be used in production');
    const path=safeFile(key);
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,content,{flag:'wx',mode:0o600});
    return;
  }
  // AWS S3 accepts SSE-S3; DigitalOcean Spaces encrypts physical disks and
  // supports a different object-level encryption model (SSE-C).
  await s3().send(new PutObjectCommand({Bucket:bucket,Key:key,Body:content,ContentType:mime,
    ServerSideEncryption:driver==='s3'?'AES256':undefined}));
}

export async function removeResume(key: string): Promise<void> {
  if(driver==='local') {await unlink(safeFile(key)).catch(()=>undefined);return;}
  await s3().send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
}

export async function downloadResume(key: string,inlinePdf=false): Promise<{url?:string;bytes?:Buffer}> {
  requirePersistentResumeStorage();
  if(driver==='local') return {bytes:await readFile(safeFile(key))};
  return {url:await getSignedUrl(s3(),new GetObjectCommand({Bucket:bucket,Key:key,
    ResponseContentDisposition:inlinePdf?'inline':undefined}),{expiresIn:120})};
}
