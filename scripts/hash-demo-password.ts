import bcrypt from 'bcryptjs';
import { stdin, stdout } from 'node:process';

if (!stdin.isTTY || !stdin.setRawMode) {
  console.error('Run this command in an interactive terminal so the password is not echoed.');
  process.exitCode = 1;
} else {
  let value = '';
  let finished = false;
  stdout.write('Enter the temporary demo password (input hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', async (chunk: Buffer) => {
    if (finished) return;
    for (const byte of chunk) {
      if (byte === 3) { stdout.write('\nCancelled.\n'); process.exit(1); }
      if (byte === 13 || byte === 10) {
        finished = true;
        stdin.setRawMode(false); stdin.pause();
        if (value.length < 1 || value.length > 128) { stdout.write('\nPassword must be 1-128 characters.\n'); process.exitCode = 1; return; }
        const hash = await bcrypt.hash(value, 12);
        value = '';
        stdout.write(`\nDEMO_ADMIN_PASSWORD_HASH=${hash}\n`);
        break;
      }
      if (byte === 8 || byte === 127) value = value.slice(0, -1);
      else if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
    }
  });
}
