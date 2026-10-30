import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialState, DomainError, LotSplitEngine, solveAllocation, termsDigest, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { createCollection, DEMO_DEFAULTS, getDemoDefaults } from './seed.js';
import { DEMO_COLLECTIONS } from '../shared/demo-collections.js';
import type { BuyerId, Collection, Participant, RehearsalScenario } from '../shared/types.js';
import type { CreateOrderInput, PaymentProvider, ProviderResult } from './paypal.js';

const NOW = '2026-10-30T12:00:00.000Z';
function fixture(path = ':memory:', now: () => Date = () => new Date(NOW)) {
  const store = new SqliteStore<DomainState>(path);
  // These financial regressions deliberately retain the historical 840 PLN example.
  store.initialize(createInitialState('rehearsal', now(), 'illustrations'));
  const engine = new LotSplitEngine(store, { mode: 'rehearsal', now });
  return { store, engine };
}
const planOf = (engine: LotSplitEngine) => { const s = engine.snapshot(); return s.plans.find(p => p.id === s.currentPlanId)!; };
function readyInput(collection: Collection, participants: Participant[]) {
  collection.catalogStatus = 'confirmed'; collection.preferencesOpened = true;
  for (const item of collection.items) item.confirmed = true;
  for (const p of participants.filter(p => p.active)) p.preferences = { ...DEMO_DEFAULTS[p.id], alternativesConfirmed: true, updatedAt: NOW, submittedAt: NOW };
}
const hasCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
function providerStub(overrides: Partial<PaymentProvider>): PaymentProvider {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected provider request'); };
  return { createOrder: unexpected, authorizeOrder: unexpected, captureAuthorization: unexpected, voidAuthorization: unexpected,
    refundCapture: unexpected, getOrder: unexpected, getAuthorization: unexpected, getCapture: unexpected, getRefund: unexpected, ...overrides };
}
function seedSandboxReady(engine: LotSplitEngine, expiresAt?: string) {
  const state = engine.snapshot(); readyInput(state.collection, state.participants);
  for (const participant of state.participants.filter(p => p.active)) participant.address = { recipient: participant.name, street: 'Testowa 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' };
  const revision = state.revision; state.revision++; engine.store.save(state, revision);
  engine.solve('kasia'); const plan = planOf(engine); engine.sendPlan('kasia', plan.id);
  for (const assignment of plan.assignments) engine.agree(assignment.buyerId, plan.id, assignment.termsDigest);
  const prepared = engine.snapshot(); const current = prepared.plans.find(p => p.id === plan.id)!;
  for (const assignment of current.assignments) {
    const buyerId = assignment.buyerId; const orderId = `order-${buyerId}`, authId = `auth-${buyerId}`;
    const common = { buyerId, planId: current.id, amountCents: assignment.totalCents, currency: 'PLN' as const,
      source: 'paypal-sandbox' as const, createdAt: NOW, updatedAt: NOW, checkNeeded: false, reconcileAttempts: 0 };
    prepared.operations[orderId] = { ...common, id: orderId, idempotencyKey: orderId, kind: 'order', status: 'CREATED', providerId: orderId };
    prepared.operations[authId] = { ...common, id: authId, idempotencyKey: authId, kind: 'authorize', status: 'AUTHORIZED', providerId: authId, expiresAt };
    current.payments[buyerId] = { orderOperationId: orderId, authorizationOperationId: authId };
  }
  const lastRevision = prepared.revision; prepared.revision++; engine.store.save(prepared, lastRevision);
  return plan.id;
}

test('solver covers all 24 items, fixed prices total 840 PLN, and increasing a limit never increases a price', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'collecting'); engine.solve('kasia');
    const first = planOf(engine).assignments;
    assert.deepEqual(first.map(a => a.totalCents), [18000, 21000, 22000, 23000]);
    assert.equal(new Set(first.flatMap(a => a.itemIds)).size, 24);
    assert.equal(first.reduce((sum, a) => sum + a.totalCents, 0), 84000);
    assert.ok(first.every(a => a.itemIds.length === 6));
    engine.savePreferences('maja', { ...DEMO_DEFAULTS.maja, budgetCents: 90000 });
    engine.saveAlternatives('maja', { alternativeItemIds: ['20'], confirmed: true }); engine.solve('kasia');
    assert.equal(planOf(engine).assignments.find(a => a.buyerId === 'maja')!.totalCents, 18000);
  } finally { store.close(); }
});

test('catalog shares require individual confirmations and sum; shares lock before limits are collected', async () => {
  const { engine, store } = fixture();
  try {
    assert.throws(() => engine.confirmCatalog('kasia'), hasCode('CATALOG_INCOMPLETE'));
    for (const item of engine.snapshot().collection.items) engine.updateItem('kasia', item.id, { confirmed: true });
    engine.updateItem('kasia', '01', { shareCents: 2600 });
    assert.throws(() => engine.confirmCatalog('kasia'), hasCode('SHARE_SUM'));
    engine.updateItem('kasia', '01', { shareCents: 2500 }); engine.confirmCatalog('kasia');
    assert.throws(() => engine.updateItem('kasia', '01', { shareCents: 3000 }), hasCode('SHARES_LOCKED'));
    assert.throws(() => engine.updateCollection('kasia', { sharedCostCents: 16000 }), hasCode('SHARES_LOCKED'));
    assert.throws(() => engine.updateItem('maja', '01', { shareCents: 0 }), hasCode('FORBIDDEN'));
  } finally { store.close(); }
});

test('alternatives require a distinct explicit confirmation and unmentioned items are never allocated', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'collecting'); engine.savePreferences('maja', DEMO_DEFAULTS.maja);
    assert.throws(() => engine.saveAlternatives('maja', { alternativeItemIds: ['20'] }), hasCode('ALTERNATIVES_CONFIRMATION'));
    assert.throws(() => engine.saveAlternatives('maja', { alternativeItemIds: ['01'], confirmed: true }), hasCode('ALTERNATIVES_OVERLAP'));
    engine.solve('kasia'); assert.equal(engine.snapshot().noSolution?.code, 'MISSING_PREFERENCES');
    engine.saveAlternatives('maja', { alternativeItemIds: [], confirmed: true });
    await engine.replace('kasia', 'jan', 'ewa'); engine.savePreferences('ewa', DEMO_DEFAULTS.ewa); engine.saveAlternatives('ewa', { alternativeItemIds: [], confirmed: true }); engine.solve('kasia');
    assert.equal(engine.snapshot().noSolution?.code, 'NO_ALLOCATION');
  } finally { store.close(); }
});

test('buyer projection contains only own financial details, own address and aggregate group progress', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'ready');
    const view = engine.view('maja'); assert.equal(view.authenticated && view.role, 'buyer');
    if (!view.authenticated || view.role !== 'buyer') throw new Error('buyer expected');
    const json = JSON.stringify(view);
    assert.equal(view.plan?.assignment.totalCents, 18000); assert.equal(view.participant.preferences?.budgetCents, 20000);
    assert.equal(view.progress.authorizations, 4);
    for (const forbidden of ['"participants"', '"assignments"', 'ola@lotsplit', 'jan@lotsplit', '"shareCents"', '"budgetCents":23000', '"amountCents":21000']) assert.ok(!json.includes(forbidden), forbidden);
    const organizer = engine.view('kasia');
    assert.ok(organizer.authenticated && organizer.role === 'organizer');
    if (organizer.authenticated && organizer.role === 'organizer') assert.ok(organizer.participants.every(p => p.address === undefined));
  } finally { store.close(); }
});

test('all exact current agreements gate every authorization; stale plans and forged digests are rejected', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'plan'); const plan = planOf(engine); engine.sendPlan('kasia', plan.id);
    assert.throws(() => engine.agree('maja', plan.id, 'wrong-digest'), hasCode('TERMS_CHANGED'));
    engine.agree('maja', plan.id, plan.assignments[0].termsDigest);
    await assert.rejects(engine.authorize('maja', plan.id), hasCode('GATE_CLOSED'));
    assert.equal(Object.values(engine.snapshot().operations).length, 0);
    engine.savePreferences('maja', DEMO_DEFAULTS.maja);
    assert.throws(() => engine.agree('ola', plan.id, plan.assignments[1].termsDigest), hasCode('STALE_PLAN'));
    assert.throws(() => engine.agree('kasia', plan.id, plan.assignments[0].termsDigest), hasCode('FORBIDDEN'));
  } finally { store.close(); }
});

test('dropout invalidates v1 and reports the 160 PLN minimum gap without reallocating costs to three buyers', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'dropout'); const state = engine.snapshot();
    assert.equal(planOf(engine).status, 'invalidated'); assert.equal(state.noSolution?.limitsTotalCents, 68000);
    assert.equal(state.noSolution?.shortfallCents, 16000); assert.deepEqual(state.noSolution?.unassignedItemIds, ['19', '20', '21', '22', '23', '24']);
    assert.equal(state.collection.sharedCostCents, 12000);
    await assert.rejects(engine.capture('kasia', planOf(engine).id), hasCode('STALE_PLAN'));
  } finally { store.close(); }
});

test('v2 uses only Maja explicit alternative; unchanged Ola and Bartek consent survives but Maja and Ewa must agree', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'v2'); const plan = planOf(engine);
    assert.equal(plan.version, 2); assert.deepEqual(plan.assignments.map(a => a.totalCents), [19000, 21000, 22000, 22000]);
    assert.deepEqual(plan.assignments[0].itemIds, ['01', '04', '07', '09', '12', '20']);
    assert.deepEqual(plan.assignments[3].itemIds, ['18', '19', '21', '22', '23', '24']);
    assert.ok(plan.consents.ola?.preservedFromPlanId); assert.ok(plan.consents.bartek?.preservedFromPlanId);
    assert.equal(plan.consents.maja, undefined); assert.equal(plan.consents.ewa, undefined);
    assert.deepEqual(plan.payments, {}); assert.equal(new Set(plan.assignments.flatMap(a => a.itemIds)).size, 24);
    assert.equal(engine.view('kasia').authenticated && (engine.view('kasia') as { progress: { agreements: number } }).progress.agreements, 2);
  } finally { store.close(); }
});

test('material terms have deterministic exact digests, while plan versions do not affect consent', () => {
  const state = createInitialState('rehearsal', new Date(NOW), 'illustrations'); const collection = state.collection;
  const initial = termsDigest(collection, 'maja', DEMO_DEFAULTS.maja.preferredItemIds, 18000);
  assert.equal(initial, termsDigest(collection, 'maja', [...DEMO_DEFAULTS.maja.preferredItemIds].reverse(), 18000));
  collection.items[0].condition = 'Rysa na rewersie';
  assert.notEqual(initial, termsDigest(collection, 'maja', DEMO_DEFAULTS.maja.preferredItemIds, 18000));
  assert.notEqual(initial, termsDigest(createInitialState('rehearsal', new Date(NOW), 'illustrations').collection, 'maja', DEMO_DEFAULTS.maja.preferredItemIds, 18001));
});

test('three authorizations cannot start even one capture; expired reservation blocks four ready authorizations', async () => {
  let now = new Date(NOW); const { engine, store } = fixture(':memory:', () => now);
  try {
    await engine.setScenario('kasia', 'three-authorizations');
    await assert.rejects(engine.capture('kasia', planOf(engine).id), hasCode('GATE_CLOSED'));
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'capture').length, 0);
    await engine.setScenario('kasia', 'ready'); now = new Date(Date.parse(engine.snapshot().collection.reservationExpiresAt) + 1);
    await assert.rejects(engine.capture('kasia', planOf(engine).id), hasCode('GATE_CLOSED'));
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'capture').length, 0);
  } finally { store.close(); }
});

test('concurrent capture requests persist exactly one operation per buyer and packing waits for all completed', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'ready'); const id = planOf(engine).id;
    await Promise.all([engine.capture('kasia', id), engine.capture('kasia', id), engine.capture('kasia', id)]);
    const state = engine.snapshot(); const captures = Object.values(state.operations).filter(op => op.kind === 'capture');
    assert.equal(captures.length, 4); assert.equal(new Set(captures.map(op => op.idempotencyKey)).size, 4);
    assert.equal(planOf(engine).status, 'paid'); assert.equal(state.packing.length, 4);
    const view = engine.view('kasia'); assert.ok(view.authenticated && view.gates.packing.allowed);
    assert.throws(() => engine.updatePacking('kasia', 'maja', { packed: true }), hasCode('PACKING_INCOMPLETE'));
    const ids = planOf(engine).assignments[0].itemIds; engine.updatePacking('kasia', 'maja', { checkedItemIds: ids, packed: true, shipped: true });
    const buyer = engine.view('maja'); assert.ok(buyer.authenticated && buyer.role === 'buyer' && buyer.shipment?.shippedAt);
  } finally { store.close(); }
});

test('unknown result is the approved Maja-completed/Ola-unknown branch; restart and retry never add another charge', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lotsplit-domain-')); const database = join(directory, 'state.sqlite');
  let current = fixture(database);
  try {
    await current.engine.setScenario('kasia', 'unknown'); let plan = planOf(current.engine); let state = current.engine.snapshot();
    assert.equal(state.operations[plan.payments.maja!.captureOperationId!].status, 'COMPLETED');
    assert.equal(state.operations[plan.payments.ola!.captureOperationId!].status, 'UNKNOWN');
    assert.equal(plan.payments.bartek!.captureOperationId, undefined); assert.equal(plan.payments.jan!.captureOperationId, undefined);
    const operationIds = Object.keys(state.operations); current.store.close(); current = fixture(database);
    await current.engine.capture('kasia', plan.id); assert.deepEqual(Object.keys(current.engine.snapshot().operations), operationIds);
    await current.engine.reconcile('kasia'); plan = planOf(current.engine); state = current.engine.snapshot();
    assert.equal(plan.status, 'failed'); assert.equal(Object.values(state.operations).filter(op => op.kind === 'capture').length, 2);
    assert.equal(state.operations[plan.payments.maja!.refundOperationId!].status, 'PENDING');
  } finally {
    current.store.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\lotsplit-domain-') || resolve(directory).startsWith(resolve(tmpdir()) + '/lotsplit-domain-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('partial failure stops later captures, refund PENDING is never success, and compensation continues after expiry', async () => {
  let now = new Date(NOW); const { engine, store } = fixture(':memory:', () => now);
  try {
    await engine.setScenario('kasia', 'partial-failure'); const plan = planOf(engine); let state = engine.snapshot();
    assert.equal(state.operations[plan.payments.maja!.refundOperationId!].status, 'PENDING');
    const voids = Object.values(state.operations).filter(op => op.kind === 'void');
    assert.equal(voids.reduce((sum, op) => sum + op.amountCents, 0), 66000); assert.ok(voids.every(op => op.status === 'PENDING'));
    assert.equal(Object.values(state.operations).filter(op => op.kind === 'capture').length, 2);
    assert.throws(() => engine.updatePacking('kasia', 'maja', { packed: true }), hasCode('GATE_CLOSED'));
    now = new Date(Date.parse(state.collection.reservationExpiresAt) + 1); await engine.reconcile('kasia'); state = engine.snapshot();
    assert.equal(state.operations[plan.payments.maja!.refundOperationId!].status, 'COMPLETED');
    assert.equal(planOf(engine).status, 'failed'); const view = engine.view('kasia'); assert.ok(view.authenticated); assert.equal(view.gates.packing.allowed, false);
  } finally { store.close(); }
});

test('prior authorizations are voided rather than silently reused by a new plan', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'ready'); const oldId = planOf(engine).id;
    await engine.withdraw('jan'); await engine.replace('kasia', 'jan', 'ewa');
    engine.savePreferences('ewa', DEMO_DEFAULTS.ewa); engine.saveAlternatives('ewa', { alternativeItemIds: [], confirmed: true }); engine.solve('kasia');
    const plan = planOf(engine); engine.sendPlan('kasia', plan.id);
    for (const assignment of plan.assignments) if (!plan.consents[assignment.buyerId]) engine.agree(assignment.buyerId, plan.id, assignment.termsDigest);
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.planId === oldId && op.kind === 'void').length, 4);
    await assert.rejects(engine.authorize('maja', plan.id), hasCode('GATE_CLOSED'));
    await engine.reconcile('kasia'); const order = await engine.authorize('maja', plan.id);
    assert.equal(engine.snapshot().operations[order.operationId].planId, plan.id); assert.notEqual(plan.id, oldId);
  } finally { store.close(); }
});

test('SQLite optimistic revision prevents a second writer from replacing committed financial state', () => {
  const { store } = fixture();
  try {
    const first = store.load()!, stale = store.load()!; first.revision++; first.rehearsalCaptureOutcome = 'unknown-ola'; store.save(first, 0);
    stale.revision++; assert.throws(() => store.save(stale, 0), /STATE_CONFLICT/);
    assert.equal(store.load()!.rehearsalCaptureOutcome, 'unknown-ola');
  } finally { store.close(); }
});

test('sandbox disables rehearsal shortcuts and a provider timeout remains one durable unknown capture', async () => {
  const store = new SqliteStore<DomainState>(':memory:'); const calls: string[] = [];
  const provider: PaymentProvider = {
    async createOrder(input) { calls.push('order'); return { providerId: `order-${input.customId}`, status: 'CREATED', amountCents: input.amountCents, currency: 'PLN', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=test' }; },
    async authorizeOrder(id) { calls.push('authorize'); return { providerId: `auth-${id}`, status: 'AUTHORIZED', amountCents: 18000, currency: 'PLN' }; },
    async captureAuthorization(_authorizationId, _amountCents, _currency, idempotencyKey) {
      const persisted = Object.values(store.load()!.operations).find(op => op.idempotencyKey === idempotencyKey);
      assert.equal(persisted?.status, 'STARTED'); assert.equal(persisted?.kind, 'capture');
      calls.push('capture'); throw Object.assign(new Error('timeout'), { uncertain: true });
    },
    async voidAuthorization() { return { providerId: 'void', status: 'VOIDED' }; },
    async refundCapture() { throw new Error('not expected'); },
    async getOrder() { return { providerId: 'order', status: 'UNKNOWN' }; },
    async getAuthorization() { return { providerId: 'auth', status: 'AUTHORIZED', amountCents: 18000, currency: 'PLN' }; },
    async getCapture() { return { providerId: 'capture', status: 'UNKNOWN' }; },
    async getRefund() { return { providerId: 'refund', status: 'UNKNOWN' }; },
  };
  const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW), paymentProvider: provider });
  try {
    await assert.rejects(engine.setScenario('kasia', 'ready'), hasCode('REHEARSAL_ONLY'));
    const state = engine.snapshot(); readyInput(state.collection, state.participants); state.revision++; store.save(state, 0);
    engine.solve('kasia'); const plan = planOf(engine); engine.sendPlan('kasia', plan.id);
    for (const a of plan.assignments) engine.agree(a.buyerId, plan.id, a.termsDigest);
    engine.saveAddress('maja', { recipient: 'Maja', street: 'Testowa 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' });
    const order = await engine.authorize('maja', plan.id); await engine.approve('maja', order.operationId);
    const prepared = engine.snapshot(); const p = prepared.plans.find(p => p.id === plan.id)!;
    for (const a of p.assignments.slice(1)) {
      const id = `fixture-${a.buyerId}`; prepared.operations[id] = { id, idempotencyKey: id, kind: 'authorize', buyerId: a.buyerId, planId: p.id,
        amountCents: a.totalCents, currency: 'PLN', status: 'AUTHORIZED', source: 'paypal-sandbox', providerId: id, createdAt: NOW, updatedAt: NOW, checkNeeded: false, reconcileAttempts: 0 };
      p.payments[a.buyerId] = { authorizationOperationId: id };
    }
    const revision = prepared.revision; prepared.revision++; store.save(prepared, revision);
    await Promise.all([engine.capture('kasia', plan.id), engine.capture('kasia', plan.id)]);
    await engine.capture('kasia', plan.id); await engine.reconcile('kasia');
    assert.equal(calls.filter(c => c === 'capture').length, 1);
    const capture = Object.values(engine.snapshot().operations).find(op => op.kind === 'capture')!; assert.equal(capture.status, 'UNKNOWN');
    assert.equal(capture.source, 'paypal-sandbox'); assert.ok(capture.idempotencyKey); assert.equal(planOf(engine).status, 'reconciling');
  } finally { store.close(); }
});

test('solver enforces each individual budget rather than using the sum of limits as permission', () => {
  const state = createInitialState('rehearsal', new Date(NOW), 'illustrations'); readyInput(state.collection, state.participants);
  state.participants[0].preferences!.budgetCents = 17999; state.participants[1].preferences!.budgetCents = 100000;
  const result = solveAllocation(state.collection, state.participants);
  assert.ok(!Array.isArray(result)); if (!Array.isArray(result)) assert.equal(result.code, 'NO_ALLOCATION');
});

test('unknown refunds cannot be retried, while a confirmed failed compensation gets one new persisted attempt', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'partial-failure'); const plan = planOf(engine); const refundId = plan.payments.maja!.refundOperationId!;
    await assert.rejects(engine.retryCompensation('kasia', refundId), hasCode('RETRY_NOT_ALLOWED'));
    const state = engine.snapshot(); state.operations[refundId].status = 'FAILED'; const revision = state.revision; state.revision++; store.save(state, revision);
    const next = await engine.retryCompensation('kasia', refundId);
    assert.notEqual(next.operationId, refundId); assert.equal(engine.snapshot().operations[next.operationId].status, 'PENDING');
    await assert.rejects(engine.retryCompensation('kasia', refundId), hasCode('STALE_OPERATION'));
    const view = engine.view('kasia'); assert.ok(view.authenticated); assert.equal(view.gates.packing.allowed, false);
  } finally { store.close(); }
});

test('an expired individual authorization blocks captures even while collection reservation remains valid', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'ready'); const state = engine.snapshot(); const plan = state.plans.find(p => p.id === state.currentPlanId)!;
    state.operations[plan.payments.maja!.authorizationOperationId!].expiresAt = '2026-10-29T12:00:00Z';
    const revision = state.revision; state.revision++; store.save(state, revision);
    await assert.rejects(engine.capture('kasia', plan.id), hasCode('GATE_CLOSED'));
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'capture').length, 0);
  } finally { store.close(); }
});

test('fresh demo and explicit scenario reset reserve for 48 hours; reads and reloads preserve the stored deadline', async () => {
  let now = new Date('2040-12-15T09:00:00.000Z'); const { engine, store } = fixture(':memory:', () => now);
  try {
    const first = engine.snapshot();
    assert.equal(first.collection.reservationExpiresAt, '2040-12-17T09:00:00.000Z');
    now = new Date('2040-12-15T10:00:00.000Z');
    engine.view('kasia');
    assert.equal(engine.snapshot().collection.reservationExpiresAt, first.collection.reservationExpiresAt);
    assert.equal(engine.snapshot().revision, first.revision);
    await engine.setScenario('kasia', 'start');
    assert.equal(engine.snapshot().collection.reservationExpiresAt, '2040-12-17T10:00:00.000Z');
    engine.updateCollection('kasia', { reservationExpiresAt: '2040-12-18T12:30:00.000Z' });
    now = new Date('2040-12-19T09:00:00.000Z');
    const reloaded = new LotSplitEngine(store, { mode: 'rehearsal', now: () => now });
    const view = reloaded.view('kasia');
    assert.ok(view.authenticated); assert.equal(view.reservationExpired, true);
    assert.equal(reloaded.snapshot().collection.reservationExpiresAt, '2040-12-18T12:30:00.000Z');
    await reloaded.setScenario('kasia', 'ready');
    const reset = reloaded.view('kasia');
    assert.ok(reset.authenticated); assert.equal(reset.reservationExpired, false);
    assert.equal(reloaded.snapshot().collection.reservationExpiresAt, '2040-12-21T09:00:00.000Z');
    assert.equal(planOf(reloaded).assignments.length, 4);
  } finally { store.close(); }
});

test('A to B to A terms require fresh consent; uninterrupted unchanged consent carries only from the preceding plan', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'agreements'); const first = planOf(engine); const original = engine.snapshot().collection.items[0].condition;
    engine.updateItem('kasia', '01', { condition: 'Rysa na rewersie', confirmed: true }); engine.confirmCatalog('kasia'); engine.solve('kasia');
    const second = planOf(engine); assert.equal(second.consents.maja, undefined); assert.equal(second.consents.ola?.preservedFromPlanId, first.id);
    engine.sendPlan('kasia', second.id); engine.agree('maja', second.id, second.assignments[0].termsDigest);
    engine.updateItem('kasia', '01', { condition: original, confirmed: true }); engine.confirmCatalog('kasia'); engine.solve('kasia');
    const third = planOf(engine);
    assert.equal(third.assignments[0].termsDigest, first.assignments[0].termsDigest);
    assert.equal(third.consents.maja, undefined); assert.equal(third.consents.ola?.preservedFromPlanId, second.id);
    engine.sendPlan('kasia', third.id); engine.agree('maja', third.id, third.assignments[0].termsDigest); engine.solve('kasia');
    const fourth = planOf(engine); assert.equal(fourth.consents.maja?.preservedFromPlanId, third.id);
    assert.equal(fourth.consents.ola?.preservedFromPlanId, third.id);
  } finally { store.close(); }
});

for (const expiry of ['authorization', 'reservation', 'authorization-after-reconcile'] as const) {
  test(`${expiry} expiry after first capture prevents every later capture and compensates the completed payment`, async () => {
    let now = new Date(NOW); const store = new SqliteStore<DomainState>(':memory:'); const captures: string[] = [], refunds: string[] = [], voids: string[] = [];
    const advance = () => { now = new Date(expiry === 'reservation' ? Date.parse(NOW) + 49 * 3600000 : Date.parse(NOW) + 2000); };
    const provider = providerStub({
      async captureAuthorization(id, amountCents, currency) {
        captures.push(id);
        if (expiry === 'authorization-after-reconcile') throw Object.assign(new Error('lost response'), { uncertain: true });
        advance(); return { providerId: 'capture-maja', status: 'COMPLETED', amountCents, currency };
      },
      async getOrder(id) { return { providerId: id, status: 'AUTHORIZED', captureId: 'capture-maja' }; },
      async getCapture(id) { advance(); return { providerId: id, status: 'COMPLETED', amountCents: 18000, currency: 'PLN' }; },
      async refundCapture(id, amountCents, currency) { refunds.push(id); return { providerId: 'refund-maja', status: 'PENDING', amountCents, currency }; },
      async voidAuthorization(id) { voids.push(id); return { providerId: id, status: 'PENDING' }; },
    });
    const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => now, paymentProvider: provider });
    try {
      const planId = seedSandboxReady(engine, expiry === 'reservation' ? undefined : new Date(now.getTime() + 1000).toISOString());
      await engine.capture('kasia', planId);
      if (expiry === 'authorization-after-reconcile') await engine.reconcile('kasia');
      assert.deepEqual(captures, ['auth-maja']); assert.deepEqual(refunds, ['capture-maja']); assert.deepEqual(voids, ['auth-ola', 'auth-bartek', 'auth-jan']);
      const plan = planOf(engine); assert.equal(plan.status, 'failed');
      assert.equal(engine.snapshot().operations[plan.payments.maja!.refundOperationId!].status, 'PENDING');
      assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'capture').length, 1);
      const view = engine.view('kasia'); assert.ok(view.authenticated); assert.equal(view.gates.packing.allowed, false); assert.deepEqual(engine.snapshot().packing, []);
    } finally { store.close(); }
  });
}

test('restart recovers an unknown order with its original frozen request and key, then uses GET after ID is known', async () => {
  const store = new SqliteStore<DomainState>(':memory:'); const requests: CreateOrderInput[] = []; let effects = 0; let gets = 0;
  const provider = providerStub({
    async createOrder(input) {
      requests.push(structuredClone(input)); if (requests.length === 1) { effects++; throw Object.assign(new Error('lost response'), { uncertain: true }); }
      return { providerId: 'same-order', status: 'CREATED', amountCents: input.amountCents, currency: input.currency, approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=same' };
    },
    async getOrder(id) { gets++; return { providerId: id, status: 'CREATED', amountCents: 18000, currency: 'PLN' }; },
  });
  let engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW), baseUrl: 'https://original.example', paymentProvider: provider });
  try {
    const id = seedSandboxReady(engine); const state = engine.snapshot(); const plan = state.plans.find(p => p.id === id)!;
    // The buyer has no order yet; the other seeded authorizations only prepare the financial prerequisites.
    delete plan.payments.maja; const revision = state.revision; state.revision++; store.save(state, revision);
    const order = await engine.authorize('maja', id); assert.equal(engine.snapshot().operations[order.operationId].status, 'UNKNOWN');
    engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(Date.parse(NOW) + 60000), baseUrl: 'https://changed.example', paymentProvider: provider });
    await Promise.all([engine.reconcile('maja', order.operationId), engine.reconcile('maja', order.operationId)]);
    assert.equal(effects, 1); assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
    assert.ok(requests[1].returnUrl.startsWith('https://original.example/')); assert.equal(engine.snapshot().operations[order.operationId].providerId, 'same-order');
    await engine.reconcile('maja', order.operationId); assert.equal(requests.length, 2); assert.ok(gets >= 1);
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'order' && op.buyerId === 'maja' && op.id !== 'order-maja').length, 1);
  } finally { store.close(); }
});

test('restart recovers STARTED before dispatch using the saved order command without minting a replacement key', async () => {
  const store = new SqliteStore<DomainState>(':memory:'); const requests: CreateOrderInput[] = [];
  const provider = providerStub({ async createOrder(input) { requests.push(structuredClone(input)); return { providerId: 'recovered-order', status: 'CREATED', amountCents: input.amountCents, currency: input.currency }; } });
  const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW), paymentProvider: provider });
  try {
    const id = seedSandboxReady(engine); const state = engine.snapshot(); const plan = state.plans.find(p => p.id === id)!;
    const operationId = 'persisted-before-dispatch'; const key = 'original-request-key';
    state.operations[operationId] = { id: operationId, idempotencyKey: key, kind: 'order', buyerId: 'maja', planId: id, amountCents: 18000, currency: 'PLN', status: 'STARTED', source: 'paypal-sandbox', createdAt: NOW, updatedAt: NOW, checkNeeded: true, reconcileAttempts: 0 };
    state.paymentCommands![operationId] = { attempts: 0, command: { kind: 'order', input: { amountCents: 18000, currency: 'PLN', idempotencyKey: key, customId: operationId, description: 'Frozen original description', returnUrl: 'https://original.example/return', cancelUrl: 'https://original.example/cancel' } } };
    plan.payments.maja = { orderOperationId: operationId }; const revision = state.revision; state.revision++; store.save(state, revision);
    const restarted = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(Date.parse(NOW) + 1000), paymentProvider: provider });
    await restarted.reconcile('maja', operationId); assert.equal(requests.length, 1); assert.equal(requests[0].idempotencyKey, key);
    assert.equal(restarted.snapshot().operations[operationId].providerId, 'recovered-order'); assert.equal(restarted.snapshot().paymentCommands![operationId].attempts, 1);
  } finally { store.close(); }
});

test('a lost refund response is recovered with the same original key, and a known refund uses GET', async () => {
  const store = new SqliteStore<DomainState>(':memory:'); const requests: unknown[][] = []; let refundEffects = 0; let gets = 0;
  const provider = providerStub({
    async captureAuthorization(id, amountCents, currency) { return { providerId: `capture-${id}`, status: id === 'auth-maja' ? 'COMPLETED' : 'FAILED', amountCents, currency }; },
    async refundCapture(id, amountCents, currency, key) { requests.push([id, amountCents, currency, key]); if (requests.length === 1) { refundEffects++; throw Object.assign(new Error('lost refund result'), { uncertain: true }); } return { providerId: 'same-refund', status: 'PENDING', amountCents, currency }; },
    async voidAuthorization(id) { return { providerId: id, status: 'VOIDED' }; },
    async getRefund(id) { gets++; return { providerId: id, status: 'COMPLETED', amountCents: 18000, currency: 'PLN' }; },
  });
  let engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW), paymentProvider: provider });
  try {
    const id = seedSandboxReady(engine); await engine.capture('kasia', id); const refundId = planOf(engine).payments.maja!.refundOperationId!;
    assert.equal(engine.snapshot().operations[refundId].status, 'UNKNOWN');
    engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(Date.parse(NOW) + 60000), paymentProvider: provider });
    await engine.reconcile('kasia', refundId); assert.equal(refundEffects, 1); assert.deepEqual(requests[1], requests[0]); assert.equal(requests.length, 2);
    await engine.reconcile('kasia', refundId); assert.equal(gets, 1); assert.equal(requests.length, 2); assert.equal(engine.snapshot().operations[refundId].status, 'COMPLETED');
    const view = engine.view('kasia'); assert.ok(view.authenticated); assert.equal(view.gates.packing.allowed, false);
  } finally { store.close(); }
});

test('missing-ID recovery outside the conservative window stays unresolved and never sends another command', async () => {
  let now = new Date(NOW); const store = new SqliteStore<DomainState>(':memory:'); let calls = 0;
  const provider = providerStub({ async createOrder() { calls++; throw Object.assign(new Error('lost result'), { uncertain: true }); } });
  const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => now, paymentProvider: provider });
  try {
    const id = seedSandboxReady(engine); const state = engine.snapshot(); delete state.plans.find(p => p.id === id)!.payments.maja;
    const revision = state.revision; state.revision++; store.save(state, revision);
    const order = await engine.authorize('maja', id); now = new Date(Date.parse(NOW) + 5 * 3600000);
    const restarted = new LotSplitEngine(store, { mode: 'sandbox', now: () => now, paymentProvider: provider });
    await restarted.reconcile('maja', order.operationId); const operation = restarted.snapshot().operations[order.operationId];
    assert.equal(calls, 1); assert.equal(operation.status, 'UNKNOWN'); assert.match(operation.lastError!, /Manual reconciliation/);
    assert.equal(operation.createdAt, NOW); assert.equal(restarted.snapshot().paymentCommands![operation.id].attempts, 1);
  } finally { store.close(); }
});

test('a rejected recovery request never converts an original unknown refund into a definite failure or permits a new key', async () => {
  const store = new SqliteStore<DomainState>(':memory:'); const keys: string[] = [];
  const provider = providerStub({
    async captureAuthorization(id, amountCents, currency) { return { providerId: `capture-${id}`, status: id === 'auth-maja' ? 'COMPLETED' : 'FAILED', amountCents, currency }; },
    async refundCapture(_id, _amount, _currency, key) {
      keys.push(key); throw Object.assign(new Error(keys.length === 1 ? 'response lost' : 'credentials rejected'), { uncertain: keys.length === 1, httpStatus: keys.length === 1 ? 503 : 401 });
    },
    async voidAuthorization(id) { return { providerId: id, status: 'VOIDED' }; },
  });
  const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW), paymentProvider: provider });
  try {
    const id = seedSandboxReady(engine); await engine.capture('kasia', id); const refundId = planOf(engine).payments.maja!.refundOperationId!;
    await engine.reconcile('kasia', refundId); assert.equal(engine.snapshot().operations[refundId].status, 'UNKNOWN');
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
    await assert.rejects(engine.retryCompensation('kasia', refundId), hasCode('RETRY_NOT_ALLOWED'));
    assert.equal(Object.values(engine.snapshot().operations).filter(op => op.kind === 'refund').length, 1);
  } finally { store.close(); }
});

test('fresh rehearsal defaults to the mixed garage sale while the historical collection factory and Sandbox keep illustrations', () => {
  const historical = createCollection(new Date(NOW));
  assert.equal(historical.name, 'Kasia’s Collection');
  assert.equal(historical.items[0].name, 'Portrait');
  assert.equal(historical.items[0].imageUrl, '/assets/items/01.png');
  assert.deepEqual(createInitialState('sandbox', new Date(NOW)).collection, historical);
  const rehearsal = createInitialState('rehearsal', new Date(NOW));
  assert.equal(rehearsal.rehearsalCollectionId, 'home');
  assert.equal(rehearsal.collection.name, 'Garage Sale');
  assert.equal(rehearsal.collection.items[0].name, 'City bicycle');
  assert.equal(rehearsal.collection.items[0].imageUrl, '/assets/examples/home/atlas.png#tile=01');
  assert.deepEqual(DEMO_COLLECTIONS.map(example => example.id), ['home', 'office', 'workshop', 'vinyl', 'books', 'illustrations']);
});

test('switching an example clears every commitment, payment command, packing entry and stale result in one new revision', async () => {
  const { engine, store } = fixture();
  try {
    await engine.setScenario('kasia', 'success');
    const paid = planOf(engine); const parcel = engine.snapshot().packing[0];
    engine.updatePacking('kasia', parcel.buyerId, { checkedItemIds: parcel.itemIds, packed: true, shipped: true });
    assert.equal(paid.status, 'paid'); assert.equal(Object.keys(paid.consents).length, 4);
    assert.ok(Object.keys(engine.snapshot().operations).length > 0);
    assert.ok(Object.keys(engine.snapshot().paymentCommands!).length > 0);
    const before = engine.snapshot();
    // A previous failure result is optional and must also disappear when a paid demo is replaced.
    before.noSolution = { code: 'NO_ALLOCATION', message: 'Old result', activeBuyerCount: 4, requiredBuyerCount: 4,
      totalCents: 84000, limitsTotalCents: 0, shortfallCents: 84000, unassignedItemIds: ['01'] };
    before.webhookEventIds.push('old-demo-event'); before.invitationTokens.ewa = 'old-demo-invitation';
    const revision = before.revision; before.revision++; store.save(before, revision);
    engine.setRehearsalCollection('kasia', 'books');
    const state = engine.snapshot();
    assert.equal(state.revision, before.revision + 1);
    assert.equal(state.rehearsalCollectionId, 'books');
    assert.deepEqual(state.collection, createCollection(new Date(NOW), 'books'));
    assert.deepEqual(state.plans, []); assert.equal(state.currentPlanId, undefined); assert.equal(state.noSolution, undefined);
    assert.deepEqual(state.operations, {}); assert.deepEqual(state.paymentCommands, {}); assert.deepEqual(state.packing, []);
    assert.deepEqual(state.webhookEventIds, []); assert.deepEqual(state.invitationTokens, {});
    assert.ok(state.participants.every(participant => !participant.preferences && !participant.address && !participant.withdrawnAt));
    assert.equal(state.participants.filter(participant => participant.active).length, 4);
    assert.equal(state.rehearsalCaptureOutcome, 'success');
    assert.equal(engine.view().rehearsalCollectionId, 'books');
    const view = engine.view('maja'); assert.ok(view.authenticated);
    assert.equal(view.rehearsalCollectionId, 'books'); assert.equal(view.gates.authorize.allowed, false);
    assert.throws(() => engine.agree('maja', paid.id, paid.assignments[0].termsDigest), hasCode('STALE_PLAN'));
    await assert.rejects(engine.authorize('maja', paid.id), hasCode('STALE_PLAN'));
  } finally { store.close(); }
});

test('only the organizer may select a valid example, and rejected choices leave the entire state unchanged', () => {
  const { engine, store } = fixture();
  try {
    const before = engine.snapshot();
    assert.throws(() => engine.setRehearsalCollection('maja', 'books'), hasCode('FORBIDDEN'));
    for (const invalid of [undefined, null, '', 'sandbox', 'constructor', ['books'], { id: 'books' }])
      assert.throws(() => engine.setRehearsalCollection('kasia', invalid), hasCode('INVALID_DEMO_COLLECTION'));
    assert.deepEqual(engine.snapshot(), before);
  } finally { store.close(); }
});

test('example selection and scenario resets reject Sandbox without rewriting an existing real collection or its payment history', async () => {
  const store = new SqliteStore<DomainState>(':memory:');
  const first = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(NOW) });
  try {
    seedSandboxReady(first);
    const saved = first.snapshot();
    saved.collection.name = 'Rzeczywista kolekcja właściciela';
    saved.collection.items[0].name = 'Rzeczywisty przedmiot'; saved.collection.items[0].imageUrl = '/uploads/real-photo.png';
    saved.collection.collectionPriceCents = 96000; saved.collection.sharedCostCents = 16000; saved.collection.totalCents = 112000;
    const revision = saved.revision; saved.revision++; store.save(saved, revision);
    const engine = new LotSplitEngine(store, { mode: 'sandbox', now: () => new Date(Date.parse(NOW) + 1000) });
    assert.deepEqual(engine.snapshot(), saved);
    for (const example of DEMO_COLLECTIONS)
      assert.throws(() => engine.setRehearsalCollection('kasia', example.id), hasCode('REHEARSAL_ONLY'));
    await assert.rejects(engine.setScenario('kasia', 'start'), hasCode('REHEARSAL_ONLY'));
    assert.throws(() => createInitialState('sandbox', new Date(NOW), 'books'), hasCode('REHEARSAL_ONLY'));
    assert.equal(engine.view().rehearsalCollectionId, undefined);
    assert.equal(engine.view('kasia').rehearsalCollectionId, undefined);
    assert.deepEqual(engine.snapshot(), saved);
  } finally { store.close(); }
});

test('historical rehearsal data remains illustrations until explicitly selected and scenario resets retain that example', async () => {
  const store = new SqliteStore<DomainState>(':memory:');
  const historical = createInitialState('rehearsal', new Date(NOW), 'illustrations');
  delete historical.rehearsalCollectionId; store.initialize(historical);
  const engine = new LotSplitEngine(store, { mode: 'rehearsal', now: () => new Date(NOW) });
  try {
    assert.equal(engine.view().rehearsalCollectionId, 'illustrations');
    assert.deepEqual(engine.snapshot(), historical);
    await engine.setScenario('kasia', 'ready');
    assert.equal(engine.snapshot().rehearsalCollectionId, 'illustrations');
    assert.equal(engine.snapshot().collection.name, historical.collection.name);
    assert.deepEqual(engine.snapshot().collection.items.map(item => [item.id, item.name, item.imageUrl]),
      historical.collection.items.map(item => [item.id, item.name, item.imageUrl]));
  } finally { store.close(); }
});

for (const expected of [
  { id: 'office', collectionPriceCents: 432000, sharedCostCents: 48000, totalCents: 480000, shortfallCents: 10000,
    budgets: [220000, 150000, 100000, 100000, 100000], firstPrices: [187000, 127000, 82000, 84000], secondPrices: [183000, 127000, 82000, 88000] },
  { id: 'workshop', collectionPriceCents: 142000, sharedCostCents: 16000, totalCents: 158000, shortfallCents: 24000,
    budgets: [65000, 33000, 36000, 43000, 43000], firstPrices: [61000, 28000, 31000, 38000], secondPrices: [62000, 28000, 31000, 37000] },
  { id: 'home', collectionPriceCents: 258000, sharedCostCents: 24000, totalCents: 282000, shortfallCents: 32000,
    budgets: [95000, 70000, 85000, 70000, 70000], firstPrices: [85500, 61000, 75000, 60500], secondPrices: [85000, 61000, 75000, 61000] },
] as const) {
  test(`${expected.id}: independent prices and budgets survive dropout and require new consent after a changed allocation`, async () => {
    const { engine, store } = fixture();
    try {
      engine.setRehearsalCollection('kasia', expected.id);
      assert.deepEqual((['maja', 'ola', 'bartek', 'jan', 'ewa'] as BuyerId[]).map(id => getDemoDefaults(expected.id, id).budgetCents), expected.budgets);
      const collection = engine.snapshot().collection;
      assert.equal(collection.collectionPriceCents, expected.collectionPriceCents);
      assert.equal(collection.sharedCostCents, expected.sharedCostCents);
      assert.equal(collection.totalCents, expected.totalCents);
      assert.ok(new Set(collection.items.map(item => item.condition)).size > 6);
      await engine.setScenario('kasia', 'agreements'); const first = planOf(engine);
      assert.deepEqual(first.assignments.map(assignment => assignment.totalCents), expected.firstPrices);
      await engine.withdraw('jan');
      assert.equal(engine.snapshot().noSolution?.shortfallCents, expected.shortfallCents);
      assert.equal(engine.snapshot().collection.totalCents, expected.totalCents);
      await engine.replace('kasia', 'jan', 'ewa');
      const defaults = getDemoDefaults(expected.id, 'ewa');
      engine.savePreferences('ewa', defaults); engine.saveAlternatives('ewa', { alternativeItemIds: defaults.alternativeItemIds, confirmed: true });
      engine.solve('kasia'); const second = planOf(engine);
      assert.deepEqual(second.assignments.map(assignment => assignment.totalCents), expected.secondPrices);
      assert.equal(second.assignments.reduce((sum, assignment) => sum + assignment.totalCents, 0), expected.totalCents);
      assert.equal(new Set(second.assignments.flatMap(assignment => assignment.itemIds)).size, 24);
      assert.ok(second.assignments.every(assignment => assignment.itemIds.length === 6));
      assert.deepEqual(second.assignments[0].alternativeItemIds, ['20']);
      assert.equal(second.consents.maja, undefined); assert.equal(second.consents.ewa, undefined);
      assert.equal(second.consents.ola?.preservedFromPlanId, first.id);
      assert.equal(second.consents.bartek?.preservedFromPlanId, first.id);
      engine.sendPlan('kasia', second.id);
      await assert.rejects(engine.authorize('maja', second.id), hasCode('GATE_CLOSED'));
      engine.agree('maja', second.id, second.assignments[0].termsDigest);
      engine.agree('ewa', second.id, second.assignments[3].termsDigest);
      const view = engine.view('maja'); assert.ok(view.authenticated && view.role === 'buyer');
      assert.equal(view.demoDefaults.budgetCents, expected.budgets[0]);
      assert.equal(view.progress.agreements, 4);
    } finally { store.close(); }
  });
}

for (const example of DEMO_COLLECTIONS) {
  test(`${example.id}: all rehearsal scenarios retain the selected catalog and use simulated payments only`, async () => {
    const store = new SqliteStore<DomainState>(':memory:'); const providerCalls: string[] = [];
    const paymentProvider = new Proxy({} as PaymentProvider, {
      get: (_target, method) => async () => { providerCalls.push(String(method)); throw new Error('External provider must not be called'); },
    });
    const engine = new LotSplitEngine(store, { mode: 'rehearsal', now: () => new Date(NOW), paymentProvider });
    try {
      engine.setRehearsalCollection('kasia', example.id);
      const initial = engine.snapshot().collection;
      const metadata = initial.items.map(item => [item.id, item.name, item.description, item.condition, item.imageUrl, item.shareCents]);
      assert.equal(new Set(initial.items.map(item => item.name)).size, 24);
      assert.equal(new Set(initial.items.map(item => item.description)).size, 24);
      assert.equal(initial.collectionPriceCents, example.collectionPriceCents);
      assert.equal(initial.sharedCostCents, example.sharedCostCents);
      assert.equal(initial.items.reduce((sum, item) => sum + item.shareCents, 0), example.collectionPriceCents);
      assert.equal(initial.totalCents, example.totalCents);
      const scenarios: RehearsalScenario[] = ['start', 'collecting', 'plan', 'agreements', 'three-authorizations', 'ready',
        'success', 'unknown', 'partial-failure', 'refund-completed', 'dropout', 'v2'];
      for (const scenario of scenarios) {
        await engine.setScenario('kasia', scenario);
        const state = engine.snapshot(); const context = `${example.id}/${scenario}`;
        assert.equal(state.rehearsalCollectionId, example.id, context);
        assert.equal(state.collection.name, initial.name, context);
        assert.deepEqual(state.collection.photos, initial.photos, context);
        assert.deepEqual(state.collection.items.map(item => [item.id, item.name, item.description, item.condition, item.imageUrl, item.shareCents]), metadata, context);
        assert.equal(state.collection.totalCents, example.totalCents, context);
        assert.ok(Object.values(state.operations).every(operation => operation.source === 'rehearsal'), context);
        if (scenario === 'start' || scenario === 'collecting') assert.equal(state.plans.length, 0, context);
        else {
          const plan = planOf(engine);
          assert.equal(new Set(plan.assignments.flatMap(assignment => assignment.itemIds)).size, 24, context);
          assert.ok(plan.assignments.every(assignment => assignment.itemIds.length === 6), context);
          assert.equal(plan.assignments.reduce((sum, assignment) => sum + assignment.totalCents, 0), example.totalCents, context);
          assert.ok(plan.assignments.every(assignment => assignment.totalCents <= getDemoDefaults(example.id, assignment.buyerId).budgetCents), context);
          assert.ok(plan.assignments.every(assignment => assignment.sharedCostCents === initial.sharedCostCents / initial.buyerCount), context);
          if (scenario === 'success') { assert.equal(plan.status, 'paid', context); assert.equal(state.packing.length, 4, context); }
          if (scenario === 'v2') {
            assert.deepEqual(plan.assignments.map(assignment => assignment.buyerId), ['maja', 'ola', 'bartek', 'ewa'], context);
            const previous = state.plans.find(candidate => candidate.version === 1)!;
            const previousMaja = previous.assignments.find(assignment => assignment.buyerId === 'maja')!;
            const maja = plan.assignments.find(assignment => assignment.buyerId === 'maja')!;
            const priceDelta = initial.items.find(item => item.id === '20')!.shareCents - initial.items.find(item => item.id === '18')!.shareCents;
            assert.equal(maja.totalCents, previousMaja.totalCents + priceDelta, context);
            assert.deepEqual(maja.alternativeItemIds, ['20'], context);
            assert.equal(plan.consents.maja, undefined, context); assert.equal(plan.consents.ewa, undefined, context);
            assert.equal(plan.consents.ola?.preservedFromPlanId, previous.id, context);
            assert.equal(plan.consents.bartek?.preservedFromPlanId, previous.id, context);
            assert.deepEqual(plan.payments, {}, context);
          }
          if (scenario === 'dropout') {
            const active = state.participants.filter(participant => participant.active);
            const limits = active.reduce((sum, participant) => sum + getDemoDefaults(example.id, participant.id).budgetCents, 0);
            assert.equal(active.length, 3, context); assert.equal(plan.status, 'invalidated', context);
            assert.equal(state.noSolution?.code, 'BUYER_COUNT', context);
            assert.equal(state.noSolution?.limitsTotalCents, limits, context);
            assert.equal(state.noSolution?.shortfallCents, example.totalCents - limits, context);
            assert.ok(state.noSolution!.shortfallCents > 0, context);
            assert.equal(state.collection.sharedCostCents, initial.sharedCostCents, context);
          }
        }
      }
      assert.deepEqual(providerCalls, []);
      const restarted = new LotSplitEngine(store, { mode: 'rehearsal', now: () => new Date(NOW), paymentProvider });
      assert.equal(restarted.view('kasia').rehearsalCollectionId, example.id);
    } finally { store.close(); }
  });
}
