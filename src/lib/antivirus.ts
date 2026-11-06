import net from 'node:net';
import { HttpError } from './auth';

// ClamAV clamd INSTREAM protocol. In production, uploads fail closed if no
// scanner is configured. This prevents uploaded documents from skipping scanning.
export async function scanResume(data:Buffer):Promise<void> {
  const host=process.env.CLAMAV_HOST;
  const port=Number(process.env.CLAMAV_PORT || 3310);
  if(!host) {
    if(process.env.NODE_ENV==='production') throw new HttpError(503,'Resume antivirus scanner is not configured');
    return;
  }
  await new Promise<void>((resolve,reject)=>{
    let result='';
    let settled=false;
    const socket=net.createConnection({host,port});
    const done=(err?:Error)=>{
      if(settled)return;
      settled=true;
      socket.destroy();
      if(err)reject(err);else resolve();
    };
    socket.setTimeout(25000,()=>done(new HttpError(503,'Antivirus scanner timeout')));
    socket.once('error',()=>done(new HttpError(503,'Antivirus scanner unavailable')));
    socket.on('connect',()=>{
      socket.write('zINSTREAM\0');
      for(let offset=0;offset<data.length;offset+=65536){
        const chunk=data.subarray(offset,offset+65536);
        const size=Buffer.allocUnsafe(4);
        size.writeUInt32BE(chunk.length,0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data',buffer=>{
      result+=buffer.toString('utf8');
      if(result.includes('\0') || result.includes('\n')) {
        if(result.includes('FOUND')) done(new HttpError(400,'Virus detected in uploaded document'));
        else if(result.includes('OK')) done();
        else done(new HttpError(503,'Antivirus scan did not pass'));
      }
    });
    socket.on('end',()=>{
      if(!settled)done(new HttpError(503,'Antivirus scanner closed unexpectedly'));
    });
  });
}
