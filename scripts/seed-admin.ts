import { pool, one, transaction } from '../src/lib/db';
import bcrypt from 'bcryptjs';

async function main() {
  const name=process.env.ORG_NAME||'SkillMint Global';
  const admin=process.env.ADMIN_NAME||'SkillMint Admin';
  const email=process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
  const password=process.env.ADMIN_PASSWORD||'';
  if(!email || password.length<12 || password==='replace-with-a-unique-long-password')
    throw new Error('Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (12+ characters) in .env.local first.');
  await transaction(async client=>{
    let org=await one<{id:string}>('SELECT id FROM organizations WHERE name=$1 LIMIT 1',[name],client);
    if(!org) org=await one('INSERT INTO organizations(name) VALUES($1) RETURNING id',[name],client);
    if(!org) throw new Error('Unable to create organization');
    const existing=await one('SELECT id FROM users WHERE organization_id=$1 AND email=$2',[org.id,email],client);
    if(existing) {console.log('Admin already exists. Existing password was not modified.');return;}
    await client.query(
      `INSERT INTO users(organization_id,full_name,email,password_hash,role,active)
       VALUES($1,$2,$3,$4,'admin',true)`,
      [org.id,admin,email,await bcrypt.hash(password,12)]);
    console.log(`Initial Admin created: ${email}`);
  });
  await pool.end();
}

main().catch(async error=>{console.error(error);await pool.end();process.exitCode=1;});
