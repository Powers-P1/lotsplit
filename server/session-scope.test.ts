import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { LotSplitEngine, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { createApiRouter } from './routes.js';

const now = new Date('2026-11-01T12:00:00Z');
const ownLot = { name: 'A different seller lot', photos: ['/assets/v2/hero.png'], buyerCount: 2,
  collectionPriceCents: 3000, reservationExpiresAt: '2026-11-02T12:00:00Z',
  pickup: { location: 'Fictional pickup', startsAt: '2026-11-03T10:00:00Z', endsAt: '2026-11-03T12:00:00Z' } };

test('Sandbox buyer sessions and unused sign-in links cannot follow reused slots into a different lot', async () => {
  const store = new SqliteStore<DomainState>(':memory:');
  const engine = new LotSplitEngine(store, { mode: 'sandbox', conceptVersion: 2, now: () => now });
  const app = express(); app.use(express.json()); app.use('/api', createApiRouter(engine));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const oldBuyer = store.createSession('maja'); const oldLink = store.createLoginLink('maja');
    const owner = store.createSession('kasia');
    const call = (path: string, cookie?: string, data?: unknown) => fetch(base + '/api' + path, {
      method: data === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { Origin: base, ...(cookie ? { Cookie: 'lotsplit_session=' + cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const created = await call('/v2/lot', owner, ownLot); assert.equal(created.status, 200);
    engine.updateParticipant('kasia', 'maja', { name: 'Different buyer', email: 'different@example.test' });
    for (const [name, shareCents] of [['A', 1000], ['B', 2000]] as const) {
      engine.addItem('kasia', { name, shareCents, condition: 'Reviewed fictional test item' });
    }
    for (const item of engine.snapshot().collection.items) engine.updateItem('kasia', item.id, { confirmed: true });
    engine.confirmCatalog('kasia');
    engine.saveBasketOptions('maja', { basketOptions: [['01']], budgetCents: 2345, confirmed: true });
    engine.saveBasketOptions('ola', { basketOptions: [['02']], budgetCents: 2000, confirmed: true });
    engine.solve('kasia'); const plan = engine.snapshot().plans.at(-1)!; engine.sendPlan('kasia', plan.id);
    const terms = engine.view('maja'); assert.ok(terms.authenticated && terms.role === 'buyer' && terms.plan);
    const staleView = await (await call('/state', oldBuyer)).json();
    assert.equal(staleView.authenticated, false);
    assert.equal(JSON.stringify(staleView).includes('2345'), false, 'The former buyer must not see a new person’s limit');
    const staleConsent = await call('/plan/agree', oldBuyer, { planId: plan.id, termsDigest: terms.plan.assignment.termsDigest });
    assert.equal(staleConsent.status, 401);
    assert.equal(engine.snapshot().plans.at(-1)!.consents.maja, undefined);
    assert.equal((await call('/auth/consume?token=' + oldLink)).status, 401);
    assert.equal(store.sessionUser(owner), 'kasia', 'The configured seller retains their workspace role');
    const fresh = store.createSession('maja');
    assert.equal(store.sessionUser(fresh), 'maja');
    const agreed = await call('/plan/agree', fresh, { planId: plan.id, termsDigest: terms.plan.assignment.termsDigest });
    assert.equal(agreed.status, 200);
  } finally { await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }); store.close(); }
});

test('Buyer credentials also stop resolving after the current participant identity changes', () => {
  const store = new SqliteStore<DomainState>(':memory:');
  try {
    const engine = new LotSplitEngine(store, { mode: 'sandbox', conceptVersion: 2, now: () => now });
    const token = store.createSession('maja'), link = store.createLoginLink('maja');
    engine.updateParticipant('kasia', 'maja', { email: 'replacement@example.test' });
    assert.equal(store.sessionUser(token), undefined); assert.equal(store.consumeLoginLink(link), undefined);
    assert.equal(store.sessionUser(store.createSession('maja')), 'maja');
  } finally { store.close(); }
});

test('Existing unscoped credentials fail closed on SQLite schema migration while financial state survives', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lotsplit-session-migration-'));
  const path = join(directory, 'fixture.sqlite'); const old = new DatabaseSync(path);
  const token = 'old-session-must-not-be-rebound', link = 'old-unused-link-must-not-be-rebound';
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const saved = { revision: 7, collection: { id: 'retained-lot', protocolVersion: 2 }, participants: [{ id: 'maja', email: 'new@example.test' }], receipt: 'retained-financial-evidence' };
  old.exec('CREATE TABLE app_state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE TABLE login_links (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER);');
  old.prepare('INSERT INTO app_state VALUES (1,?,?)').run(saved.revision, JSON.stringify(saved));
  old.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), 'maja', Date.now() + 600000);
  old.prepare('INSERT INTO login_links VALUES (?,?,?,NULL)').run(hash(link), 'maja', Date.now() + 600000); old.close();
  let store = new SqliteStore<typeof saved>(path);
  try {
    assert.deepEqual(store.load(), saved); assert.equal(store.sessionUser(token), undefined); assert.equal(store.consumeLoginLink(link), undefined);
    const fresh = store.createSession('maja'); assert.equal(store.sessionUser(fresh), 'maja');
    store.close(); store = new SqliteStore<typeof saved>(path);
    assert.equal(store.sessionUser(fresh), 'maja', 'Scoped credentials survive a normal restart of the same lot');
    assert.deepEqual(store.load(), saved);
    const freshLink = store.createLoginLink('maja'); assert.equal(store.consumeLoginLink(freshLink), 'maja'); assert.equal(store.consumeLoginLink(freshLink), undefined);
  } finally {
    store.close(); assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('lotsplit-session-migration-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
