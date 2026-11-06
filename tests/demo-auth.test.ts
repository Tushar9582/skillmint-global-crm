import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { POST as login } from '../src/app/api/auth/login/route';
import { POST as logout } from '../src/app/api/auth/logout/route';
import { api } from '../src/lib/http';
import { isDemoModeRequested, isDevDemoMode, isStagingDemoMode, resolveDemoActor } from '../src/lib/auth';

const password = randomBytes(24).toString('base64url');
const secret = 'local-test-secret-0123456789-abcdef';
let hash = '';
const original = {
  nodeEnv: process.env.NODE_ENV,
  demoMode: process.env.DEMO_MODE,
  isolated: process.env.DEMO_DATA_ISOLATED,
  databaseUrl: process.env.DATABASE_URL,
  netlifyDatabaseUrl: process.env.NETLIFY_DATABASE_URL,
  adminEmail: process.env.DEMO_ADMIN_EMAIL,
  adminHash: process.env.DEMO_ADMIN_PASSWORD_HASH,
  sessionSecret: process.env.DEMO_SESSION_SECRET,
  appOrigin: process.env.APP_ORIGIN,
  devDemo: process.env.DEV_DEMO_MODE,
};
function configureStaging() {
  Reflect.set(process.env, 'NODE_ENV', 'production');
  process.env.DEMO_MODE = 'true';
  process.env.DEMO_DATA_ISOLATED = 'true';
  delete process.env.DATABASE_URL;
  delete process.env.NETLIFY_DATABASE_URL;
  process.env.DEMO_ADMIN_EMAIL = 'skillmint@gmail.com';
  process.env.DEMO_ADMIN_PASSWORD_HASH = hash;
  process.env.DEMO_SESSION_SECRET = secret;
  delete process.env.APP_ORIGIN;
}
function request(url: string, method: string, body?: unknown, ip = '198.51.100.10') {
  return new NextRequest(url, { method, headers: { 'x-nf-client-connection-ip': ip, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

before(async () => { hash = await bcrypt.hash(password, 10); configureStaging(); });

test('Netlify demo credentials authenticate without a database and issue an HttpOnly Secure session', async () => {
  assert.equal(isStagingDemoMode(), true);
  const res = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: ' SKILLMINT@gmail.com ', password }));
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.mode, 'isolated-demo'); assert.equal(body.user.email, 'skillmint@gmail.com'); assert.equal(body.user.role, 'admin');
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /skillmint_session=demo\./);
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=lax/i); assert.match(cookie, /Max-Age=28800/);
  const token = decodeURIComponent(cookie.match(/skillmint_session=([^;]+)/)![1]);
  const actor = resolveDemoActor(token);
  assert.equal(actor?.email, 'skillmint@gmail.com'); assert.equal(actor?.role, 'admin');
});

test('demo session signature and eight-hour expiry are enforced', async () => {
  const res = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password }));
  const cookie = res.headers.get('set-cookie')!;
  const token = decodeURIComponent(cookie.match(/skillmint_session=([^;]+)/)![1]);
  assert.ok(resolveDemoActor(token));
  assert.equal(resolveDemoActor(`${token}x`), null);
  assert.equal(resolveDemoActor(token, Date.now() + 8 * 60 * 60 * 1000 + 1), null);
});

test('invalid credentials are generic and rate-limited per IP and identity', async () => {
  const wrongEmail = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'someone@example.com', password }, '198.51.100.20'));
  const wrongPassword = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password: 'wrong' }, '198.51.100.21'));
  assert.equal(wrongEmail.status, 401); assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongEmail.json(), await wrongPassword.json());
  let last: Response | null = null;
  for (let i = 0; i < 10; i++) last = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password: 'bad' }, '198.51.100.30'));
  assert.equal(last?.status, 401);
  const limited = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password }, '198.51.100.30'));
  assert.equal(limited.status, 429); assert.match((await limited.json()).error, /15 minutes/);
  const otherIp = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password }, '198.51.100.31'));
  assert.equal(otherIp.status, 200);
});

test('database settings disable demo authentication and protected APIs fail closed', async () => {
  process.env.DATABASE_URL = 'postgres://production.invalid/database';
  assert.equal(isDemoModeRequested(), true); assert.equal(isStagingDemoMode(), false);
  const res = await login(request('https://staging.example.net/api/auth/login', 'POST', { email: 'skillmint@gmail.com', password }));
  assert.equal(res.status, 503);
  const protectedHandler = api(async () => NextResponse.json({ leaked: true }));
  const blocked = await protectedHandler(request('https://staging.example.net/api/v1/candidates', 'GET'));
  assert.equal(blocked.status, 503);
  delete process.env.DATABASE_URL;
  const protectedAgain = await protectedHandler(request('https://staging.example.net/api/v1/candidates', 'GET'));
  assert.equal(protectedAgain.status, 404);
});

test('logout clears the staging cookie without touching the database', async () => {
  configureStaging();
  const res = await logout(request('https://staging.example.net/api/auth/logout', 'POST'));
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /skillmint_session=/); assert.match(cookie, /Max-Age=0/); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i);
});

test('normal production authentication remains separate and localhost bypass is unchanged', () => {
  Reflect.set(process.env, 'NODE_ENV', 'production'); delete process.env.DEMO_MODE;
  assert.equal(isDemoModeRequested(), false); assert.equal(isStagingDemoMode(), false);
  Reflect.set(process.env, 'NODE_ENV', 'development'); process.env.DEV_DEMO_MODE = 'true';
  assert.equal(isDevDemoMode(), true); assert.equal(isStagingDemoMode(), false);
});

test('restore environment after the test file', () => {
  for (const [key, value] of Object.entries({
    NODE_ENV: original.nodeEnv, DEMO_MODE: original.demoMode, DEMO_DATA_ISOLATED: original.isolated,
    DATABASE_URL: original.databaseUrl, NETLIFY_DATABASE_URL: original.netlifyDatabaseUrl,
    DEMO_ADMIN_EMAIL: original.adminEmail, DEMO_ADMIN_PASSWORD_HASH: original.adminHash,
    DEMO_SESSION_SECRET: original.sessionSecret, APP_ORIGIN: original.appOrigin, DEV_DEMO_MODE: original.devDemo,
  })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.equal(NextResponse !== undefined, true);
});
