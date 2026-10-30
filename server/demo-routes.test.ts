import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApiRouter, type ApiRouterOptions } from './routes.js';
import { LotSplitEngine, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import type { AppMode, ApiError, ApiResult } from '../shared/types.js';

async function withApi(mode: AppMode, run: (engine: LotSplitEngine, post: Post) => Promise<void>, options: ApiRouterOptions = {}) {
  const store = new SqliteStore<DomainState>(':memory:');
  const engine = new LotSplitEngine(store, { mode, now: () => new Date('2026-10-30T12:00:00Z') });
  const app = express(); app.use(express.json()); app.use('/api', createApiRouter(engine, options));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const post: Post = async (path, body, cookie) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
      });
      return { status: response.status, cookie: response.headers.get('set-cookie'), body: await response.json() as DemoApiResponse };
    };
    await run(engine, post);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    store.close();
  }
}
type DemoApiResponse = ApiResult & ApiError & { source?: string; proposal?: { maxTotalCents: number; preferredIds: string[]; alternativeIds: string[] } };
type Post = (path: string, body: unknown, cookie?: string) => Promise<{ status: number; cookie: string | null; body: DemoApiResponse }>;

test('a configured instance cookie isolates login, authenticated actions and logout from other local runtimes', async () => {
  await withApi('rehearsal', async (engine, post) => {
    const signedIn = await post('/auth/demo', { inviteToken: 'demo-kasia' });
    const ownCookie = signedIn.cookie?.split(';')[0];
    assert.ok(ownCookie?.startsWith('lotsplit_recording='));
    assert.match(signedIn.cookie!, /HttpOnly/i); assert.match(signedIn.cookie!, /SameSite=Lax/i);
    const ownToken = ownCookie.split('=')[1];
    const otherToken = engine.store.createSession('ola');
    const foreignName = await post('/plan/solve', {}, `lotsplit_session=${ownToken}`);
    assert.equal(foreignName.status, 401);
    const ownAction = await post('/rehearsal/scenario', { scenario: 'collecting' }, `lotsplit_session=${otherToken}; ${ownCookie}`);
    assert.equal(ownAction.status, 200);
    assert.ok(ownAction.body.state?.authenticated && ownAction.body.state.me.id === 'kasia');
    const logout = await post('/auth/logout', {}, `lotsplit_session=${otherToken}; ${ownCookie}`);
    assert.match(logout.cookie!, /^lotsplit_recording=;/);
    assert.equal(engine.store.sessionUser(ownToken), undefined);
    assert.equal(engine.store.sessionUser(otherToken), 'ola');
    assert.equal((await post('/plan/solve', {}, ownCookie)).status, 401);
  }, { sessionCookieName: 'lotsplit_recording' });
});

test('demo entry selects and resets a collection only for Kasia; persona login keeps the existing state', async () => {
  await withApi('rehearsal', async (engine, post) => {
    await engine.setScenario('kasia', 'ready'); const previous = engine.snapshot();
    const buyerReset = await post('/auth/demo', { inviteToken: 'demo-maja', collectionId: 'books' });
    assert.equal(buyerReset.status, 403); assert.equal(buyerReset.body.code, 'FORBIDDEN'); assert.equal(buyerReset.cookie, null);
    assert.deepEqual(engine.snapshot(), previous);
    const selected = await post('/auth/demo', { inviteToken: 'demo-kasia', collectionId: 'books' });
    assert.equal(selected.status, 200); assert.ok(selected.cookie);
    assert.ok(selected.body.state.authenticated); assert.equal(selected.body.state.me.id, 'kasia');
    assert.equal(selected.body.state.rehearsalCollectionId, 'books');
    assert.equal(selected.body.state.collection.name, 'Moving-Day Bookshelf');
    assert.equal(engine.snapshot().currentPlanId, undefined); assert.deepEqual(engine.snapshot().operations, {});
    const snapshot = engine.snapshot();
    const persona = await post('/auth/demo', { inviteToken: 'demo-maja' });
    assert.equal(persona.status, 200); assert.ok(persona.body.state.authenticated);
    assert.equal(persona.body.state.me.id, 'maja'); assert.equal(persona.body.state.rehearsalCollectionId, 'books');
    assert.deepEqual(engine.snapshot(), snapshot);
  });
});

test('collection endpoint requires organizer authentication and rejects invalid IDs before mutating the demo', async () => {
  await withApi('rehearsal', async (engine, post) => {
    const organizerCookie = `lotsplit_session=${engine.store.createSession('kasia')}`;
    const buyerCookie = `lotsplit_session=${engine.store.createSession('ola')}`;
    const before = engine.snapshot();
    assert.equal((await post('/rehearsal/collection', { collectionId: 'books' })).status, 401);
    assert.equal((await post('/rehearsal/collection', { collectionId: 'books' }, buyerCookie)).status, 403);
    const invalid = await post('/rehearsal/collection', { collectionId: 'other' }, organizerCookie);
    assert.equal(invalid.status, 400); assert.equal(invalid.body.code, 'INVALID_DEMO_COLLECTION');
    assert.deepEqual(engine.snapshot(), before);
    const selected = await post('/rehearsal/collection', { collectionId: 'illustrations' }, organizerCookie);
    assert.equal(selected.status, 200); assert.equal(selected.body.state.rehearsalCollectionId, 'illustrations');
    assert.ok(selected.body.state.authenticated); assert.equal(selected.body.state.collection.items[0].name, 'Portrait');
  });
});

test('both example entry and the authenticated collection endpoint explicitly reject Sandbox and preserve its snapshot', async () => {
  await withApi('sandbox', async (engine, post) => {
    const organizerCookie = `lotsplit_session=${engine.store.createSession('kasia')}`;
    engine.updateCollection('kasia', { name: 'Istniejąca kolekcja Sandbox', collectionPriceCents: 100000, sharedCostCents: 20000 });
    const before = engine.snapshot();
    const entry = await post('/auth/demo', { inviteToken: 'demo-kasia', collectionId: 'vinyl' });
    assert.equal(entry.status, 403); assert.equal(entry.body.code, 'REHEARSAL_ONLY'); assert.equal(entry.cookie, null);
    const selected = await post('/rehearsal/collection', { collectionId: 'books' }, organizerCookie);
    assert.equal(selected.status, 403); assert.equal(selected.body.code, 'REHEARSAL_ONLY');
    assert.deepEqual(engine.snapshot(), before);
  });
});

test('garage sale, office and workshop entry, buyer view and simulated AI use the selected example prices and limits', async () => {
  await withApi('rehearsal', async (engine, post) => {
    const buyerCookie = `lotsplit_session=${engine.store.createSession('maja')}`;
    for (const expected of [{ id: 'home', totalCents: 282000, budgetCents: 95000 }, { id: 'office', totalCents: 480000, budgetCents: 220000 },
      { id: 'workshop', totalCents: 158000, budgetCents: 65000 }] as const) {
      const selected = await post('/auth/demo', { inviteToken: 'demo-kasia', collectionId: expected.id });
      assert.equal(selected.status, 200); assert.ok(selected.body.state.authenticated);
      assert.equal(selected.body.state.collection.totalCents, expected.totalCents);
      await engine.setScenario('kasia', 'collecting');
      const result = await post('/ai/preferences', { text: 'Chcę sześć wybranych przedmiotów w swoim limicie.' }, buyerCookie);
      assert.equal(result.status, 200); assert.equal(result.body.source, 'rehearsal');
      assert.equal(result.body.proposal?.maxTotalCents, expected.budgetCents);
      assert.deepEqual(result.body.proposal?.preferredIds, ['01', '04', '07', '09', '12', '18']);
      assert.deepEqual(result.body.proposal?.alternativeIds, ['20']);
      const state = result.body.state; assert.ok(state.authenticated && state.role === 'buyer');
      assert.equal(state.demoDefaults.budgetCents, expected.budgetCents);
      assert.equal(state.participant.preferences?.budgetCents, expected.budgetCents);
      assert.equal(state.rehearsalCollectionId, expected.id);
    }
  });
});
