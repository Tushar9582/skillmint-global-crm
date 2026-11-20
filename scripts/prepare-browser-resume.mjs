import { mkdirSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'skillmint-pdfjs-'));
try {
  execSync('npm install --prefix "'+dir+'" --no-package-lock --no-audit --no-fund --ignore-scripts --omit=optional pdfjs-dist@5.4.624',{stdio:'inherit'});
  const root=join(dir,'node_modules','pdfjs-dist');
  const out='public/resume-parser-assets';
  mkdirSync(out,{recursive:true});
  for(const name of ['pdf.mjs','pdf.worker.mjs'])cpSync(join(root,'build',name),join(out,name));
  for(const name of ['cmaps','standard_fonts','wasm','LICENSE'])if(existsSync(join(root,name)))cpSync(join(root,name),join(out,name),{recursive:true});
  cpSync('node_modules/mammoth/mammoth.browser.min.js',join(out,'mammoth.js'));
} finally {rmSync(dir,{recursive:true,force:true});}
