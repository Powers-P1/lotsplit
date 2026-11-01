import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const serverPath = fileURLToPath(new URL('./index.ts', import.meta.url));
const basic = `Basic ${Buffer.from('jury:hosting-test-password').toString('base64')}`;

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  child.kill();
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function isolatedServer(overrides: Record<string, string> = {}, mockPayPalWebhook = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lotsplit-hosting-safety-'));
  let child: ChildProcess | undefined;
  async function dispose() {
    if (child) await stop(child);
    // Only the exact temporary directory created by this test may be removed.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('lotsplit-hosting-safety-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  try {
    await mkdir(join(directory, 'dist', 'client'), { recursive: true });
    await writeFile(join(directory, 'dist', 'client', 'index.html'), '<!doctype html><title>Private test build</title>');
    const publicDirectory = join(directory, 'dist', 'client', 'site');
    await mkdir(publicDirectory, { recursive: true });
    await Promise.all([
      ...['index', 'privacy', 'judges'].map(name => writeFile(join(publicDirectory, name + '.html'), '<!doctype html><title>Public LOTSPLIT ' + name + '</title><p>Public presentation only.</p>')),
      writeFile(join(publicDirectory, 'styles.css'), 'body{color:#244b3b}'),
      writeFile(join(publicDirectory, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ]);
    let entryPath = serverPath;
    if (mockPayPalWebhook) {
      entryPath = join(directory, 'mock-webhook-entry.mjs');
      await writeFile(entryPath, `globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith('/v1/oauth2/token')) return Response.json({ access_token: 'mock-token', expires_in: 3600 });
        if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
          const body = JSON.parse(String(init.body));
          return Response.json({ verification_status: body.webhook_id === 'WH-MOCK' && body.transmission_sig === 'mock-valid-signature' ? 'SUCCESS' : 'FAILURE' });
        }
        throw new Error('Unexpected external request in isolated test');
      }; await import(${JSON.stringify(pathToFileURL(serverPath).href)});`);
    }
    const reservation = createServer();
    await new Promise<void>((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
    const address = reservation.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((done, fail) => reservation.close(error => error ? fail(error) : done()));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, entryPath], {
      cwd: directory,
      env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'production', APP_MODE: 'rehearsal',
        HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, RENDER_EXTERNAL_URL: '',
        DATA_DIR: join(directory, 'data'), NEBIUS_ENV_FILE: '', NEBIUS_API_KEY: 'dummy-hosting-test-key',
        NEBIUS_BASE_URL: 'https://api.tokenfactory.nebius.com/v1', NEBIUS_TEXT_MODEL: '', NEBIUS_MODEL: '', NEBIUS_VISION_MODEL: '',
        PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', PAYPAL_WEBHOOK_ID: '', ORGANIZER_ACCESS_TOKEN: '',
        PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_MODE: 'sandbox', PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
        SESSION_COOKIE_NAME: 'lotsplit_session', AI_DAILY_REQUEST_LIMIT: '1',
        JUDGE_ACCESS_USERNAME: '', JUDGE_ACCESS_PASSWORD: '', ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    child.stdout?.on('data', chunk => { output += String(chunk); });
    child.stderr?.on('data', chunk => { output += String(chunk); });
    let spawnError: Error | undefined;
    child.once('error', error => { spawnError = error; });
    async function ready() {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(`Isolated server exited before readiness: ${output}`);
        try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* Startup is still in progress. */ }
        await delay(50);
      }
      throw new Error(`Isolated server did not become ready: ${output}`);
    }
    async function exited() {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && child!.exitCode === null && child!.signalCode === null && !spawnError) await delay(50);
      if (spawnError) throw spawnError;
      assert.notEqual(child!.exitCode, null, 'Invalid configuration must terminate without serving requests');
      assert.notEqual(child!.exitCode, 0);
      return output;
    }
    return { origin, ready, exited, dispose };
  } catch (error) { await dispose(); throw error; }
}

test('private judging gate covers pages, assets and API while health reveals no provider metadata', async () => {
  const server = await isolatedServer({ JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' });
  try {
    await server.ready();
    const health = await fetch(`${server.origin}/api/health`);
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await fetch(`${server.origin}/api/health`, { method: 'HEAD' })).status, 200);
    for (const path of ['/', '/assets/private.png', '/api/state', '/payment/return?operationId=test']) {
      const denied = await fetch(`${server.origin}${path}`);
      assert.equal(denied.status, 401, path);
      assert.match(denied.headers.get('www-authenticate') || '', /^Basic /);
      assert.equal(denied.headers.get('cache-control'), 'no-store');
      assert.equal((await denied.json()).code, 'JUDGE_ACCESS_REQUIRED');
    }
    for (const authorization of ['Bearer example', 'Basic !!!', `Basic ${Buffer.from('jury:wrong-password').toString('base64')}`])
      assert.equal((await fetch(`${server.origin}/api/state`, { headers: { authorization } })).status, 401);
    assert.equal((await fetch(`${server.origin}/api/health`, { method: 'POST' })).status, 401);
    const page = await fetch(`${server.origin}/`, { headers: { authorization: basic } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Private test build/);
    const callback = await fetch(`${server.origin}/payment/return?operationId=test`, { headers: { authorization: basic } });
    assert.equal(callback.status, 200);
    const state = await fetch(`${server.origin}/api/state`, { headers: { authorization: basic } });
    assert.equal(state.status, 200);
    assert.equal((await state.json()).authenticated, false, 'Basic gate must not grant an application role');
  } finally { await server.dispose(); }
});

test('public presentation is reachable without opening app roles, AI, payment returns or private photos', async () => {
  const server = await isolatedServer({ JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' });
  try {
    await server.ready();
    for (const path of ['/about', '/privacy', '/judges', '/site/styles.css', '/site/favicon.svg']) {
      const response = await fetch(server.origin + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('www-authenticate'), null);
      assert.equal(response.headers.get('set-cookie'), null, 'Reading public material must not mint a judging or role session');
      assert.ok(!(await response.text()).includes('hosting-test-password'));
      if (!path.startsWith('/site/')) {
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.match(response.headers.get('content-security-policy') || '', /form-action 'none'/);
        assert.match(response.headers.get('content-security-policy') || '', /frame-src https:\/\/www\.youtube-nocookie\.com/);
      }
    }
    for (const path of ['/', '/?guide=1', '/api/state', '/api/session', '/payment/return?operationId=existing', '/assets/private-photo.png']) {
      assert.equal((await fetch(server.origin + path)).status, 401, path);
    }
    for (const path of ['/about', '/api/ai/assistant', '/api/payments/capture']) {
      assert.equal((await fetch(server.origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, path);
    }
    const anonymous = await fetch(server.origin + '/api/state', { headers: { authorization: basic } });
    assert.equal((await anonymous.json()).authenticated, false);
    const publicQuery = await fetch(server.origin + '/about?invite=PRIVATE-INVITATION-CANARY');
    assert.ok(!(await publicQuery.text()).includes('PRIVATE-INVITATION-CANARY'), 'Presentation pages must never echo invitations');
  } finally { await server.dispose(); }
});

test('public static paths cannot traverse into app state and indexing exposes only the presentation', async () => {
  const server = await isolatedServer({ JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' });
  try {
    await server.ready();
    for (const path of ['/site/../api/state', '/site/%2e%2e%2fapi%2fstate', '/site/.env.local', '/site/not-a-public-file']) {
      const response = await fetch(server.origin + path);
      assert.ok([400, 401, 403, 404].includes(response.status), path + ' must not expose application data');
    }
    const robots = await fetch(server.origin + '/robots.txt');
    assert.equal(robots.status, 200);
    const policy = await robots.text();
    assert.match(policy, /Allow: \/about/);
    assert.match(policy, /Disallow: \/\n/);
    const sitemap = await fetch(server.origin + '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.ok(!(await sitemap.text()).includes('/api/'));
    const appPage = await fetch(server.origin + '/', { headers: { authorization: basic } });
    assert.equal(appPage.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await fetch(server.origin + '/about', { method: 'HEAD' })).status, 200);
  } finally { await server.dispose(); }
});

test('only the exact webhook POST bypasses private judging and still requires its configured PayPal signature', async () => {
  const headers = { 'content-type': 'application/json', 'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/MOCK', 'paypal-transmission-id': 'test-transmission',
    'paypal-transmission-time': '2026-10-30T12:00:00Z', 'paypal-transmission-sig': 'mock-valid-signature' };
  for (const webhookId of ['WH-MOCK', '']) {
    const server = await isolatedServer({ APP_MODE: 'sandbox', PAYPAL_CLIENT_ID: 'mock-client', PAYPAL_CLIENT_SECRET: 'mock-secret',
      PAYPAL_WEBHOOK_ID: webhookId, ORGANIZER_ACCESS_TOKEN: 'mock-organizer-token',
      JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' }, true);
    try {
      await server.ready();
      const post = (requestHeaders: Record<string, string>, path = '/api/payments/webhook') => fetch(`${server.origin}${path}`, {
        method: 'POST', headers: requestHeaders, body: JSON.stringify({ id: 'WH-TEST-EVENT', event_type: 'PAYMENT.AUTHORIZATION.CREATED', resource: { id: 'AUTH-UNRELATED' } }),
      });
      const valid = await post(headers);
      if (webhookId) { assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { received: true }); }
      else { assert.ok(valid.status >= 400); assert.notEqual((await valid.json()).received, true); }
      if (webhookId) {
        const invalid = await post({ ...headers, 'paypal-transmission-sig': 'mock-invalid-signature' });
        assert.equal(invalid.status, 401); assert.equal((await invalid.json()).code, 'WEBHOOK_SIGNATURE');
        const missing = await post({ 'content-type': 'application/json' });
        assert.equal(missing.status, 401); assert.equal((await missing.json()).code, 'WEBHOOK_SIGNATURE');
      }
      for (const path of ['/api/payments/webhook/', '/api/payments/webhook-extra', '/api/state']) {
        const denied = await post(headers, path); assert.equal(denied.status, 401); assert.equal((await denied.json()).code, 'JUDGE_ACCESS_REQUIRED');
      }
      const deniedGet = await fetch(`${server.origin}/api/payments/webhook`);
      assert.equal(deniedGet.status, 401); assert.equal((await deniedGet.json()).code, 'JUDGE_ACCESS_REQUIRED');
    } finally { await server.dispose(); }
  }
});

test('judge sign-in survives a merchant return without Authorization and does not grant an application role', async () => {
  const server = await isolatedServer({ JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' });
  try {
    await server.ready();
    const login = await fetch(`${server.origin}/`, { headers: { authorization: basic } });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(';')[0];
    assert.match(cookie, /^lotsplit_judge=\d{13}\.[a-f0-9]{64}$/);
    const returned = await fetch(`${server.origin}/payment/return?operationId=existing-order`, { headers: { cookie } });
    assert.equal(returned.status, 200, 'The authenticated browser must not face a new Basic challenge after PayPal');
    assert.match(await returned.text(), /Private test build/);
    const view = await fetch(`${server.origin}/api/state`, { headers: { cookie } });
    assert.equal(view.status, 200);
    assert.equal((await view.json()).authenticated, false, 'The gate session must not become buyer or seller consent');
    for (const invalid of [cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0'), cookie.replace(/=\d{13}\./, '=1000000000000.'), 'lotsplit_judge=malformed']) {
      assert.equal((await fetch(`${server.origin}/payment/return?operationId=existing-order`, { headers: { cookie: invalid } })).status, 401);
    }
  } finally { await server.dispose(); }
});

test('a hosted judge session is Secure and is invalidated when judging credentials change', async () => {
  const server = await isolatedServer({ APP_ORIGIN: 'https://review.example', JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' });
  const changed = await isolatedServer({ APP_ORIGIN: 'https://review.example', JUDGE_ACCESS_USERNAME: 'jury', JUDGE_ACCESS_PASSWORD: 'different-hosting-test-password' });
  try {
    await server.ready(); await changed.ready();
    const login = await fetch(`${server.origin}/`, { headers: { authorization: basic } });
    const setCookie = login.headers.get('set-cookie') || '';
    assert.match(setCookie, /; Secure/i);
    const cookie = setCookie.split(';')[0];
    assert.equal((await fetch(`${server.origin}/payment/return`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${changed.origin}/payment/return`, { headers: { cookie } })).status, 401);
  } finally { await server.dispose(); await changed.dispose(); }
});

test('gate is off by default and unauthenticated AI requests cannot exhaust the authenticated allowance', async () => {
  const server = await isolatedServer();
  try {
    await server.ready();
    const health = await fetch(`${server.origin}/api/health`);
    assert.equal((await health.json()).mode, 'rehearsal');
    assert.equal((await fetch(`${server.origin}/`)).status, 200);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`${server.origin}/api/ai/preferences`, { method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'lotsplit_session=invalid-unrecognized-token' }, body: JSON.stringify({ text: 'A test preference' }) });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 'UNAUTHENTICATED');
    }
    const login = await fetch(`${server.origin}/api/auth/demo`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteToken: 'demo-maja' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const request = () => fetch(`${server.origin}/api/ai/preferences`, { method: 'POST',
      headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ text: 'A test preference' }) });
    const first = await request();
    assert.equal(first.status, 409);
    assert.equal((await first.json()).code, 'CATALOG_REQUIRED', 'The first authenticated request must reach the normal application gate without any upstream request');
    const second = await request();
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, 'AI_RATE_LIMIT');
  } finally { await server.dispose(); }
});

test('partial judging credentials and invalid AI limits fail startup', async () => {
  for (const overrides of [
    { JUDGE_ACCESS_USERNAME: 'jury' },
    { JUDGE_ACCESS_PASSWORD: 'hosting-test-password' },
    { JUDGE_ACCESS_USERNAME: 'bad:user', JUDGE_ACCESS_PASSWORD: 'hosting-test-password' },
    { AI_DAILY_REQUEST_LIMIT: 'not-a-number' },
    { AI_DAILY_REQUEST_LIMIT: '0' },
  ]) {
    const server = await isolatedServer(overrides);
    try { assert.match(await server.exited(), /JUDGE_ACCESS_USERNAME|AI_DAILY_REQUEST_LIMIT/); }
    finally { await server.dispose(); }
  }
});
