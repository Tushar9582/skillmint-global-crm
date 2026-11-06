import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pool } from '../src/lib/db';

async function main() {
  const root=resolve(process.cwd(),'db');
  const files=['schema.sql',...(await readdir(resolve(root,'migrations')).catch(()=>[] as string[]))
    .filter(name=>name.endsWith('.sql')).sort().map(name=>`migrations/${name}`)];
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for(const file of files) {
      await client.query(await readFile(resolve(root,file),'utf8'));
      console.log(`Applied ${file}`);
    }
    await client.query('COMMIT');
    console.log('SkillMint database schema created / verified.');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
