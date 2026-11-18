import { hash } from 'bcryptjs';
import { transaction,pool,one,sql } from '../src/lib/db';
async function main(){
  const email=(process.env.SAAS_OWNER_EMAIL||'').trim().toLowerCase(),password=process.env.SAAS_OWNER_PASSWORD||'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<16||Buffer.byteLength(password,'utf8')>72)throw Error('Set a separate SAAS_OWNER_EMAIL and strong SAAS_OWNER_PASSWORD privately (16+ characters, at most 72 UTF-8 bytes).');
  const passwordHash=await hash(password,12);
  await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(183716929)');
    if(await one('SELECT user_id FROM saas_platform_owner',[],client))throw Error('A platform owner already exists.');
    if(await one('SELECT id FROM users WHERE email=$1',[email],client))throw Error('Use a separate email, not an existing CRM account.');
    const org=await one<{id:string}>("INSERT INTO organizations(name) VALUES('Platform Administration') RETURNING id",[],client);
    if(!org)throw Error('Owner workspace failed');
    const user=await one<{id:string}>("INSERT INTO users(organization_id,full_name,email,password_hash,role,active,must_change_password) VALUES($1,'Platform Owner',$2,$3,'admin',true,false) RETURNING id",[org.id,email,passwordHash],client);
    if(!user)throw Error('Owner account failed');
    await sql("INSERT INTO saas_workspace_access(organization_id,status) VALUES($1,'platform')",[org.id],client);
    await sql('INSERT INTO saas_platform_owner(user_id) VALUES($1)',[user.id],client);
  });
  console.log('Platform owner created. Remove bootstrap password from your environment.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Owner setup failed');process.exitCode=1;}).finally(()=>pool.end());
