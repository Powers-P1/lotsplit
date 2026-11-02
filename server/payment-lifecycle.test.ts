import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, LotSplitEngine, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { v2Defaults } from './v2-catalog.js';
import type { BuyerView, OrganizerView } from '../shared/types.js';
import type { PaymentProvider, ProviderResult } from './paypal.js';
import { PayPalProviderError, PayPalSandboxProvider } from './paypal.js';

const NOW = new Date('2026-11-01T09:00:00.000Z');
const current = (engine: LotSplitEngine) => { const state = engine.snapshot(); return state.plans.find(plan => plan.id === state.currentPlanId)!; };
const event = (id: string, event_type: string, resourceId: string, related_ids?: Record<string, string>) =>
  ({ id, event_type, resource: { id: resourceId, status: 'UNTRUSTED_PAYLOAD_STATUS', supplementary_data: { related_ids } } });
const refundEvent = (id: string, up = 'https://api.sandbox.paypal.com/v2/payments/captures/C1') => ({
  id, event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'EXTERNAL-REFUND', status: 'COMPLETED',
    amount: { value: '380.00', currency_code: 'PLN' }, links: [
      { rel: 'self', href: 'https://api.sandbox.paypal.com/v2/payments/refunds/EXTERNAL-REFUND' }, { rel: 'up', href: up },
    ] },
});
const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;

async function fixture(initialHolds = 4) {
  const store = new SqliteStore<DomainState>(':memory:');
  const orders = new Map<string, ProviderResult>(), authorizations = new Map<string, ProviderResult>(), captures = new Map<string, ProviderResult>();
  const writes: { kind: string; id: string; key: string; amountCents?: number }[] = [];
  const reads: string[] = [];
  const hooks: {
    authorizationRead?: (id: string) => Promise<ProviderResult>;
    captureRead?: (id: string) => Promise<ProviderResult>;
    refundRead?: (id: string) => Promise<ProviderResult>;
    captured?: (id: string, result: ProviderResult) => Promise<void>;
  } = {};
  const provider: PaymentProvider = {
    async createOrder(input) {
      const id = `O${orders.size + 1}`; writes.push({ kind: 'order', id, key: input.idempotencyKey });
      const result: ProviderResult = { providerId: id, status: 'CREATED', amountCents: input.amountCents, currency: input.currency };
      orders.set(id, result); return { ...result };
    },
    async authorizeOrder(orderId, key) {
      const order = orders.get(orderId)!; const id = `A${authorizations.size + 1}`;
      writes.push({ kind: 'authorize', id: orderId, key });
      const result: ProviderResult = { providerId: id, status: 'AUTHORIZED', amountCents: order.amountCents, currency: order.currency };
      order.authorizationId = id; authorizations.set(id, result); return { ...result };
    },
    async captureAuthorization(id, amountCents, currency, key, invoiceId) {
      writes.push({ kind: 'capture', id, key, amountCents });
      const result: ProviderResult = { providerId: `C${captures.size + 1}`, status: 'COMPLETED', amountCents, currency, invoiceId };
      captures.set(result.providerId, result);
      [...orders.values()].find(order => order.authorizationId === id)!.captureId = result.providerId;
      await hooks.captured?.(id, { ...result }); return { ...result };
    },
    async voidAuthorization(id, key) {
      writes.push({ kind: 'void', id, key }); authorizations.set(id, { ...authorizations.get(id)!, status: 'VOIDED' });
      return { providerId: id, status: 'VOIDED' };
    },
    async refundCapture(id, amountCents, currency, key) {
      writes.push({ kind: 'refund', id, key, amountCents });
      captures.set(id, { ...captures.get(id)!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      return { providerId: `R${writes.filter(write => write.kind === 'refund').length}`, status: 'COMPLETED', amountCents, currency };
    },
    async getOrder(id) { reads.push(`order:${id}`); return { ...orders.get(id)! }; },
    async getAuthorization(id) { reads.push(`authorize:${id}`); return hooks.authorizationRead ? hooks.authorizationRead(id) : { ...authorizations.get(id)! }; },
    async getCapture(id) { reads.push(`capture:${id}`); return hooks.captureRead ? hooks.captureRead(id) : { ...captures.get(id)! }; },
    async getRefund(id) { reads.push(`refund:${id}`); if (hooks.refundRead) return hooks.refundRead(id); throw new Error('No refund read is expected'); },
  };
  const engine = new LotSplitEngine(store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: provider });
  for (const item of engine.snapshot().collection.items) engine.updateItem('kasia', item.id, { confirmed: true });
  engine.confirmCatalog('kasia');
  for (const participant of engine.snapshot().participants.filter(p => p.active)) {
    const defaults = v2Defaults(engine.snapshot().collection, participant.id);
    engine.saveBasketOptions(participant.id, { basketOptions: [participant.id === 'ola' ? ['04', '12'] : defaults.preferredItemIds], budgetCents: defaults.budgetCents, confirmed: true });
  }
  engine.solve('kasia'); const plan = current(engine); engine.sendPlan('kasia', plan.id);
  for (const assignment of plan.assignments) engine.agree(assignment.buyerId, plan.id, assignment.termsDigest);
  for (const assignment of plan.assignments.slice(0, initialHolds)) {
    const order = await engine.authorize(assignment.buyerId, plan.id); await engine.approve(assignment.buyerId, order.operationId);
  }
  assert.equal(engine.view('kasia').gates.capture.allowed, initialHolds === plan.assignments.length);
  return { store, engine, provider, orders, authorizations, captures, writes, reads, hooks };
}

for (const reversal of ['VOIDED', 'EXPIRED'] as const) {
  test(`a received ${reversal} authorization is read by exact ID, closes capture and never repeats an authorization`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      const plan = current(engine); const payment = plan.payments.ola!; const original = engine.snapshot().operations[payment.authorizationOperationId!];
      f.authorizations.set('A2', { ...f.authorizations.get('A2')!, status: reversal === 'VOIDED' ? 'VOIDED' : 'FAILED', rawStatus: reversal });
      const requestCount = f.writes.length;
      await engine.verifiedWebhook(event(`authorization-${reversal}`, `PAYMENT.AUTHORIZATION.${reversal}`, 'A2'));
      assert.deepEqual(f.reads, ['authorize:A2']); assert.equal(engine.view('kasia').gates.capture.allowed, false);
      assert.deepEqual(engine.snapshot().operations[original.id], { ...original, reconcileAttempts: 1 });
      const buyer = engine.view('ola') as BuyerView;
      assert.equal(buyer.plan?.payment.authorization?.status, reversal === 'VOIDED' ? 'VOIDED' : 'FAILED');
      assert.equal(buyer.plan?.payment.authorization?.checkNeeded, false);
      assert.equal(JSON.parse(JSON.stringify(buyer)).plan.payment.authorization.providerChange, true);
      assert.equal(Object.hasOwn(engine.snapshot().operations[original.id], 'providerChange'), false);
      assert.match(buyer.plan!.payment.authorization!.lastError!, /no longer available/);
      await assert.rejects(engine.capture('kasia', plan.id), code('GATE_CLOSED'));
      assert.equal((await engine.approve('ola', payment.orderOperationId!)).operationId, original.id);
      assert.equal((await engine.authorize('ola', plan.id)).operationId, payment.orderOperationId);
      await assert.rejects(engine.retryAuthorization('ola', original.id), code('RETRY_NOT_ALLOWED'));
      await engine.reconcile('kasia');
      assert.equal(f.writes.length, requestCount); assert.deepEqual(f.reads, ['authorize:A2']);
    } finally { store.close(); }
  });
}

test('an unavailable authorization read closes capture before awaiting, persists across reload, and a lagged positive event cannot clear it', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    f.hooks.authorizationRead = async () => { await waiting; throw new Error('Provider read unavailable'); };
    const requestCount = f.writes.length;
    const notification = event('void-unknown', 'PAYMENT.AUTHORIZATION.VOIDED', 'A2');
    const receiving = engine.verifiedWebhook(notification);
    assert.equal(engine.view('kasia').gates.capture.allowed, false);
    await assert.rejects(engine.capture('kasia', current(engine).id), code('GATE_CLOSED'));
    release(); await receiving;
    const reloaded = new LotSplitEngine(store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    assert.equal(reloaded.view('kasia').gates.capture.allowed, false);
    await reloaded.verifiedWebhook(notification); assert.deepEqual(f.reads, ['authorize:A2']);
    delete f.hooks.authorizationRead;
    await reloaded.verifiedWebhook(event('late-created', 'PAYMENT.AUTHORIZATION.CREATED', 'A2'));
    assert.equal(reloaded.view('kasia').gates.capture.allowed, false);
    assert.equal((reloaded.view('ola') as BuyerView).plan?.payment.authorization?.status, 'UNKNOWN');
    f.authorizations.set('A2', { ...f.authorizations.get('A2')!, status: 'VOIDED' });
    await reloaded.reconcile('kasia');
    assert.equal((reloaded.view('ola') as BuyerView).plan?.payment.authorization?.status, 'VOIDED');
    assert.equal(f.writes.length, requestCount); assert.ok(f.reads.every(read => read === 'authorize:A2'));
  } finally { store.close(); }
});

test('a matching positive lifecycle observation does not label an unchanged successful payment as a provider change', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    const count = f.writes.length;
    await engine.verifiedWebhook(event('authorization-created', 'PAYMENT.AUTHORIZATION.CREATED', 'A2'));
    const authorization = (engine.view('ola') as BuyerView).plan!.payment.authorization!;
    assert.equal(authorization.status, 'AUTHORIZED'); assert.equal(authorization.providerChange, undefined);
    assert.equal(engine.view('kasia').gates.capture.allowed, true); assert.equal(f.writes.length, count);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(authorization)), 'providerChange'), false);
  } finally { store.close(); }
});

test('an older successful hold read cannot clear a newer unresolved observation of the same hold', async () => {
  const f = await fixture(); const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    let reads = 0;
    f.hooks.authorizationRead = async id => {
      if (++reads === 1) { entered.resolve(); await release.promise; return { ...f.authorizations.get(id)! }; }
      return { ...f.authorizations.get(id)!, status: 'UNKNOWN', rawStatus: 'CAPTURED' };
    };
    const older = f.engine.verifiedWebhook(event('first-hold-hint', 'PAYMENT.AUTHORIZATION.CREATED', 'A2'));
    await entered.promise;
    await f.engine.verifiedWebhook(event('newer-hold-hint', 'PAYMENT.AUTHORIZATION.CREATED', 'A2'));
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    release.resolve(); await older;
    assert.equal((f.engine.view('ola') as BuyerView).plan?.payment.authorization?.status, 'UNKNOWN');
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false); assert.equal(f.writes.some(w => w.kind === 'capture'), false);
  } finally { release.resolve(); f.store.close(); }
});

test('a confirmed external capture reversal preserves COMPLETED history and refunds only the other buyers', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); assert.equal(engine.view('kasia').gates.packing.allowed, true);
    const original = structuredClone(engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!]);
    f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
    await engine.verifiedWebhook(event('reversed', 'PAYMENT.CAPTURE.REVERSED', 'C1'));
    assert.deepEqual(f.reads, ['capture:C1']);
    assert.deepEqual(engine.snapshot().operations[original.id], { ...original, reconcileAttempts: 1 });
    assert.equal(current(engine).status, 'failed'); assert.equal(engine.view('kasia').gates.packing.allowed, false);
    assert.deepEqual((engine.view('kasia') as OrganizerView).packing, []);
    assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C2', 'C3', 'C4']);
    assert.equal(f.writes.filter(write => write.kind === 'void').length, 0);
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'FAILED');
    const count = f.writes.length;
    await engine.verifiedWebhook(event('late-completed', 'PAYMENT.CAPTURE.COMPLETED', 'C1')); await engine.reconcile('kasia');
    assert.equal(f.writes.length, count); assert.equal(engine.view('kasia').gates.packing.allowed, false);
    assert.equal(engine.view('kasia').gates.editPreferences.allowed, true);
  } finally { store.close(); }
});

for (const signal of ['REVERSED', 'DECLINED', 'DENIED'] as const) {
  test(`${signal} capture signal blocks preparation when GET is still COMPLETED and later positive delivery cannot resurrect it`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      await engine.capture('kasia', current(engine).id); const requestCount = f.writes.length;
      await engine.verifiedWebhook(event(`adverse-${signal}`, `PAYMENT.CAPTURE.${signal}`, 'C1'));
      assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(current(engine).status, 'reconciling');
      assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'UNKNOWN');
      await engine.verifiedWebhook(event(`positive-${signal}`, 'PAYMENT.CAPTURE.COMPLETED', 'C1'));
      await engine.reconcile('kasia');
      assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(f.writes.length, requestCount);
      assert.equal(Object.values(engine.snapshot().operations).filter(operation => operation.kind === 'capture' && operation.status === 'COMPLETED').length, 4);
      f.captures.set('C1', { ...f.captures.get('C1')!, status: 'FAILED', rawStatus: 'DECLINED' });
      await engine.reconcile('kasia');
      assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C2', 'C3', 'C4']);
    } finally { store.close(); }
  });
}

test('a failed or partial capture lifecycle read keeps preparation closed without guessing a full refund', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); const requestCount = f.writes.length;
    f.hooks.captureRead = async () => { throw new Error('Read unavailable'); };
    await engine.verifiedWebhook(event('unknown-capture', 'PAYMENT.CAPTURE.REVERSED', 'C1'));
    assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(f.writes.length, requestCount);
    delete f.hooks.captureRead;
    f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'PARTIALLY_REFUNDED' });
    await engine.reconcile('kasia'); assert.equal(f.writes.length, requestCount);
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.checkNeeded, true);
    assert.equal(engine.view('kasia').gates.packing.allowed, false);
  } finally { store.close(); }
});

for (const mismatch of ['amount', 'currency', 'missing-money'] as const) {
  test(`an external REFUNDED capture with ${mismatch} mismatch cannot confirm full release or trigger other refunds`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      await engine.capture('kasia', current(engine).id); const requestCount = f.writes.length;
      const original = { ...f.captures.get('C1')!, status: 'UNKNOWN' as const, rawStatus: 'REFUNDED' };
      f.captures.set('C1', { ...original, ...(mismatch === 'amount' ? { amountCents: original.amountCents! - 1 }
        : mismatch === 'currency' ? { currency: 'USD' } : { amountCents: undefined, currency: undefined }) });
      await engine.verifiedWebhook(event(`refunded-${mismatch}`, 'PAYMENT.CAPTURE.REVERSED', 'C1'));
      await engine.reconcile('kasia');
      assert.equal(current(engine).status, 'reconciling'); assert.equal(engine.view('kasia').gates.packing.allowed, false);
      assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.checkNeeded, true);
      assert.equal(f.writes.length, requestCount);
      f.captures.set('C1', original); await engine.reconcile('kasia');
      assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C2', 'C3', 'C4']);
    } finally { store.close(); }
  });
}

test('confirmed external releases block replacement refund and void attempts after earlier compensation failures', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    const originalCapture = f.provider.captureAuthorization;
    f.provider.captureAuthorization = async (id, amountCents, currency, key) => id === 'A2'
      ? { providerId: 'C2', status: 'FAILED', amountCents, currency }
      : originalCapture(id, amountCents, currency, key);
    f.provider.refundCapture = async (id, _amount, _currency, key) => {
      f.writes.push({ kind: 'refund', id, key }); throw new PayPalProviderError('MOCK_REJECTED', 'Mock confirmed rejection', false);
    };
    f.provider.voidAuthorization = async (id, key) => {
      f.writes.push({ kind: 'void', id, key }); throw new PayPalProviderError('MOCK_REJECTED', 'Mock confirmed rejection', false);
    };
    await engine.capture('kasia', current(engine).id);
    const refundId = current(engine).payments.maja!.refundOperationId!, voidId = current(engine).payments.bartek!.voidOperationId!;
    assert.equal(engine.snapshot().operations[refundId].status, 'FAILED'); assert.equal(engine.snapshot().operations[voidId].status, 'FAILED');
    f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
    f.authorizations.set('A3', { ...f.authorizations.get('A3')!, status: 'VOIDED' });
    const requestCount = f.writes.length;
    await engine.verifiedWebhook(event('external-capture-release', 'PAYMENT.CAPTURE.REVERSED', 'C1'));
    await engine.verifiedWebhook(event('external-authorization-release', 'PAYMENT.AUTHORIZATION.VOIDED', 'A3'));
    await assert.rejects(engine.retryCompensation('kasia', refundId), code('RETRY_NOT_ALLOWED'));
    await assert.rejects(engine.retryCompensation('kasia', voidId), code('RETRY_NOT_ALLOWED'));
    assert.equal(f.writes.length, requestCount);
    assert.equal(current(engine).payments.maja!.refundOperationId, refundId);
    assert.equal(current(engine).payments.bartek!.voidOperationId, voidId);
  } finally { store.close(); }
});

test('a received authorization reversal during the first capture stops later captures and keeps explicit compensation history', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async id => {
      assert.equal(id, 'A1'); f.authorizations.set('A2', { ...f.authorizations.get('A2')!, status: 'VOIDED' });
      await engine.verifiedWebhook(event('void-during-capture', 'PAYMENT.AUTHORIZATION.VOIDED', 'A2'));
    };
    await engine.capture('kasia', current(engine).id);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C1']);
    assert.deepEqual(f.writes.filter(write => write.kind === 'void').map(write => write.id), ['A3', 'A4']);
    const plan = current(engine); assert.equal(plan.status, 'failed');
    assert.equal(engine.snapshot().operations[plan.payments.maja!.captureOperationId!].status, 'COMPLETED');
    assert.equal(engine.snapshot().operations[plan.payments.maja!.refundOperationId!].status, 'COMPLETED');
    assert.equal(engine.view('kasia').gates.packing.allowed, false);
    const count = f.writes.length; await engine.reconcile('kasia'); assert.equal(f.writes.length, count);
  } finally { store.close(); }
});

test('a capture reversal delivered before the capture response cannot be overwritten by that successful response', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async (id, result) => {
      f.captures.set(result.providerId, { ...result, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      await engine.verifiedWebhook(event('early-reversal', 'PAYMENT.CAPTURE.REVERSED', result.providerId, { authorization_id: id }));
    };
    await engine.capture('kasia', current(engine).id);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.equal(f.writes.filter(write => write.kind === 'refund').length, 0);
    assert.deepEqual(f.writes.filter(write => write.kind === 'void').map(write => write.id), ['A2', 'A3', 'A4']);
    const captureId = current(engine).payments.maja!.captureOperationId!;
    assert.equal(engine.snapshot().operations[captureId].status, 'COMPLETED');
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'FAILED');
    assert.equal(current(engine).status, 'failed');
  } finally { store.close(); }
});

test('missing/unrelated resource IDs never select unset operations and refund events read the capture ID, not the refund ID', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.verifiedWebhook({ id: 'missing-id', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: {} });
    await engine.verifiedWebhook(event('unrelated', 'PAYMENT.AUTHORIZATION.VOIDED', 'UNRELATED', { order_id: 'O2' }));
    assert.deepEqual(f.reads, []); assert.equal(engine.view('kasia').gates.capture.allowed, true);
    await engine.capture('kasia', current(engine).id);
    f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
    await engine.verifiedWebhook(event('external-refund', 'PAYMENT.CAPTURE.REFUNDED', 'EXTERNAL-REFUND', { capture_id: 'C1' }));
    assert.deepEqual(f.reads, ['capture:C1']);
    assert.equal(engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!].providerId, 'C1');
    assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C2', 'C3', 'C4']);
  } finally { store.close(); }
});

for (const host of ['api.sandbox.paypal.com', 'api-m.sandbox.paypal.com']) {
  test(`an external Refund-shaped webhook routes its canonical ${host} up link to the saved capture only`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      await engine.capture('kasia', current(engine).id);
      const capture = structuredClone(engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!]);
      assert.equal(current(engine).payments.maja!.refundOperationId, undefined);
      f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      await engine.verifiedWebhook(refundEvent(`external-refund-${host}`, `https://${host}/v2/payments/captures/C1`));
      assert.deepEqual(f.reads, ['capture:C1']);
      assert.deepEqual(engine.snapshot().operations[capture.id], { ...capture, reconcileAttempts: 1 });
      assert.equal(engine.view('kasia').gates.packing.allowed, false);
      assert.equal(current(engine).payments.maja!.refundOperationId, undefined);
      assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C2', 'C3', 'C4']);
    } finally { store.close(); }
  });
}

for (const outcome of ['partial', 'amount-mismatch', 'currency-mismatch'] as const) {
  test(`a canonical refund up link with ${outcome} GET closes fulfillment without inventing a full refund`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      await engine.capture('kasia', current(engine).id); const count = f.writes.length;
      f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: outcome === 'partial' ? 'PARTIALLY_REFUNDED' : 'REFUNDED',
        ...(outcome === 'amount-mismatch' ? { amountCents: 1 } : outcome === 'currency-mismatch' ? { currency: 'USD' } : {}) });
      await engine.verifiedWebhook(refundEvent(`external-refund-${outcome}`));
      assert.deepEqual(f.reads, ['capture:C1']); assert.equal(f.writes.length, count);
      assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(current(engine).status, 'reconciling');
      assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.providerChange, true);
      assert.equal(current(engine).payments.maja!.refundOperationId, undefined);
    } finally { store.close(); }
  });
}

test('unrelated, malformed and ambiguous refund up links never select or request a payment resource', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); const count = f.writes.length;
    const invalid = [
      'https://unrelated.example/v2/payments/captures/C1',
      'https://api.sandbox.paypal.com.unrelated.example/v2/payments/captures/C1',
      'http://api.sandbox.paypal.com/v2/payments/captures/C1',
      'https://api.sandbox.paypal.com:444/v2/payments/captures/C1',
      'https://api.sandbox.paypal.com@unrelated.example/v2/payments/captures/C1',
      'https://unexpected@api.sandbox.paypal.com/v2/payments/captures/C1',
      'https://api.sandbox.paypal.com/v2/payments/captures/C1?next=elsewhere',
      'https://api.sandbox.paypal.com/v2/payments/captures/C1#fragment',
      'https://api.sandbox.paypal.com/v2/payments/captures/C1/',
      'https://api.sandbox.paypal.com/v2/payments/captures/C1\n',
      'https://api.sandbox.paypal.com/v2/payments/captures/C1%2Fanything',
      '/v2/payments/captures/C1',
      'https://api.sandbox.paypal.com/v2/payments/captures/UNRELATED',
    ];
    for (const [index, href] of invalid.entries()) await engine.verifiedWebhook(refundEvent(`invalid-up-${index}`, href));
    await engine.verifiedWebhook({ id: 'ambiguous-up', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'EXTERNAL-REFUND', links: [
      { rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/C1' },
      { rel: 'up', href: 'https://api.sandbox.paypal.com/v2/payments/captures/C2' },
    ] } });
    await engine.verifiedWebhook({ id: 'wrong-rel', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'EXTERNAL-REFUND', links: [
      { rel: 'self', href: 'https://api.sandbox.paypal.com/v2/payments/captures/C1' }, null, { rel: 'up', href: 42 },
    ] } });
    assert.deepEqual(f.reads, []); assert.equal(f.writes.length, count);
    assert.equal(engine.view('kasia').gates.packing.allowed, true);
  } finally { store.close(); }
});

test('a canonical refund received before the capture ID attaches is retained, matched and settled before any later capture', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    const notification = refundEvent('refund-before-capture-response');
    f.hooks.captured = async (id, result) => {
      if (id !== 'A1') return;
      f.captures.set('C1', { ...result, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      await engine.verifiedWebhook(notification);
    };
    await engine.capture('kasia', current(engine).id);
    await engine.verifiedWebhook(notification);
    await engine.reconcile('kasia', current(engine).payments.maja!.captureOperationId!);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.ok(f.reads.includes('capture:C1'));
    assert.equal(current(engine).status, 'failed'); assert.equal(engine.view('kasia').gates.packing.allowed, false);
    assert.equal(engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!].status, 'COMPLETED');
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'FAILED');
    assert.equal(f.writes.filter(write => write.kind === 'refund').length, 0);
    assert.deepEqual(f.writes.filter(write => write.kind === 'void').map(write => write.id), ['A2', 'A3', 'A4']);
  } finally { store.close(); }
});

test('an unmatched canonical refund survives a lost capture response and engine reload without replaying a provider command', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async (id, result) => {
      assert.equal(id, 'A1'); f.captures.set('C1', { ...result, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      await engine.verifiedWebhook(refundEvent('refund-before-lost-response'));
      throw Object.assign(new Error('Capture response lost'), { uncertain: true });
    };
    await engine.capture('kasia', current(engine).id); delete f.hooks.captured;
    const reloaded = new LotSplitEngine(store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    const readOrder = f.provider.getOrder;
    f.provider.getOrder = async id => { const result = await readOrder(id); delete result.captureId; return result; };
    await reloaded.reconcile('kasia');
    assert.equal(current(reloaded).status, 'reconciling');
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    f.provider.getOrder = readOrder;
    await reloaded.reconcile('kasia');
    assert.equal(current(reloaded).status, 'failed'); assert.equal(reloaded.view('kasia').gates.packing.allowed, false);
    assert.equal((reloaded.view('maja') as BuyerView).plan?.payment.capture?.status, 'FAILED');
    assert.equal((reloaded.view('maja') as BuyerView).plan?.payment.capture?.providerChange, true);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.equal(f.writes.filter(write => write.kind === 'refund').length, 0);
  } finally { store.close(); }
});

test('an unknown spent authorization never prevents refunding its certain completed capture after another capture fails', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    const originalCapture = f.provider.captureAuthorization;
    f.provider.captureAuthorization = async (id, amountCents, currency, key) => {
      if (id !== 'A2') return originalCapture(id, amountCents, currency, key);
      f.writes.push({ kind: 'capture', id, key, amountCents });
      f.authorizations.set('A1', { ...f.authorizations.get('A1')!, status: 'UNKNOWN', rawStatus: 'CAPTURED' });
      await engine.verifiedWebhook(event('late-created-spent-authorization', 'PAYMENT.AUTHORIZATION.CREATED', 'A1'));
      throw new PayPalProviderError('MOCK_FAILURE', 'Definitive mock failure', false);
    };
    await engine.capture('kasia', current(engine).id); await engine.reconcile('kasia');
    assert.equal(current(engine).status, 'failed');
    assert.deepEqual(f.writes.filter(write => write.kind === 'refund').map(write => write.id), ['C1']);
    assert.equal(engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!].status, 'COMPLETED');
    assert.equal(engine.snapshot().operations[current(engine).payments.maja!.refundOperationId!].status, 'COMPLETED');
    engine.solve('kasia');
    assert.deepEqual((engine.view('kasia') as OrganizerView).priorPaymentBlockers, [], 'the full refund accounts for the spent authorization');
  } finally { store.close(); }
});

test('a pending external refund blocks preparation even while the capture still reads COMPLETED', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); const count = f.writes.length;
    f.hooks.refundRead = async id => ({ providerId: id, status: 'PENDING', amountCents: 38000, currency: 'PLN' });
    await engine.verifiedWebhook({ ...refundEvent('external-pending'), event_type: 'PAYMENT.REFUND.PENDING' });
    assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(current(engine).status, 'reconciling');
    assert.deepEqual(f.reads, ['capture:C1', 'refund:EXTERNAL-REFUND']); assert.equal(f.writes.length, count);
  } finally { store.close(); }
});

test('a failed external refund with an intact capture resolves its temporary warning and preserves preparation history', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); const plan = current(engine);
    engine.updatePacking('kasia', 'maja', { checkedItemIds: plan.assignments.find(a => a.buyerId === 'maja')!.itemIds, packed: true });
    const packing = structuredClone(engine.snapshot().packing); const count = f.writes.length;
    f.hooks.refundRead = async id => ({ providerId: id, status: 'PENDING', amountCents: 38000, currency: 'PLN' });
    await engine.verifiedWebhook({ ...refundEvent('pending-before-failed'), event_type: 'PAYMENT.REFUND.PENDING' });
    assert.equal(engine.view('kasia').gates.packing.allowed, false);
    f.hooks.refundRead = async id => ({ providerId: id, status: 'FAILED' });
    await engine.verifiedWebhook({ ...refundEvent('external-failed'), event_type: 'PAYMENT.REFUND.FAILED' });
    await engine.reconcile('kasia');
    assert.equal(current(engine).status, 'paid'); assert.equal(engine.view('kasia').gates.packing.allowed, true);
    assert.deepEqual(engine.snapshot().packing, packing); assert.equal(f.writes.length, count);
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.providerChange, undefined);
    assert.ok(f.reads.includes('refund:EXTERNAL-REFUND'));
  } finally { store.close(); }
});

test('a definitive capture error cannot discard a previously received refund or permit compensation against its unidentified resource', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async (_id, result) => {
      f.captures.set('C1', { ...result, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
      await engine.verifiedWebhook(refundEvent('refund-before-definitive-error'));
      throw new PayPalProviderError('MOCK_REJECTED', 'Mock definitive error after received refund', false);
    };
    await engine.capture('kasia', current(engine).id);
    assert.equal(f.writes.some(write => write.kind === 'void' && write.id === 'A1'), false);
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'UNKNOWN');
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.providerChange, true);
    await engine.reconcile('kasia');
    const capture = engine.snapshot().operations[current(engine).payments.maja!.captureOperationId!];
    assert.equal(capture.status, 'FAILED'); assert.equal(capture.providerId, 'C1');
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.providerChange, true);
    assert.equal(f.writes.filter(write => write.kind === 'refund').length, 0);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.equal(f.writes.some(write => write.kind === 'void' && write.id === 'A1'), false);
    assert.equal(engine.view('kasia').gates.packing.allowed, false);
  } finally { store.close(); }
});

test('an unrelated capture ID received during a request is discarded after the real ID is attached without reading the unrelated resource', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async id => {
      if (id === 'A1') await engine.verifiedWebhook(refundEvent('unrelated-inflight-refund', 'https://api.sandbox.paypal.com/v2/payments/captures/UNRELATED'));
    };
    await engine.capture('kasia', current(engine).id);
    assert.deepEqual(f.reads, []); assert.equal(current(engine).status, 'paid'); assert.equal(engine.view('kasia').gates.packing.allowed, true);
    assert.equal(f.writes.filter(write => write.kind === 'refund' || write.kind === 'void').length, 0);
    assert.equal(Object.keys(engine.snapshot().pendingCaptureChanges ?? {}).length, 0);
  } finally { store.close(); }
});

test('unmatched in-flight event hints are bounded and overflow stops further captures until the change can be reviewed', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.captured = async id => {
      assert.equal(id, 'A1');
      for (let index = 0; index < 40; index++) await engine.verifiedWebhook(refundEvent(`many-${index}`, `https://api.sandbox.paypal.com/v2/payments/captures/UNRELATED-${index}`));
      const pending = Object.values(engine.snapshot().pendingCaptureChanges!);
      assert.equal(pending.length, 1); assert.ok(pending[0].changes.length <= 16); assert.equal(pending[0].overflow, true);
    };
    await engine.capture('kasia', current(engine).id);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.equal(current(engine).status, 'reconciling'); assert.equal(engine.view('kasia').gates.packing.allowed, false);
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'UNKNOWN');
    assert.ok(f.reads.every(read => read === 'capture:C1'));
  } finally { store.close(); }
});

test('a pending refund received before capture identity is known still stops the remaining group captures', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    f.hooks.refundRead = async id => ({ providerId: id, status: 'PENDING', amountCents: 38000, currency: 'PLN' });
    f.hooks.captured = async id => {
      if (id === 'A1') await engine.verifiedWebhook({ ...refundEvent('early-pending-refund'), event_type: 'PAYMENT.REFUND.PENDING' });
    };
    await engine.capture('kasia', current(engine).id);
    assert.deepEqual(f.writes.filter(write => write.kind === 'capture').map(write => write.id), ['A1']);
    assert.deepEqual(f.reads, ['capture:C1', 'refund:EXTERNAL-REFUND']);
    assert.equal(current(engine).status, 'reconciling'); assert.equal(engine.view('kasia').gates.packing.allowed, false);
    assert.equal(f.writes.some(write => write.kind === 'refund' || write.kind === 'void'), false);
  } finally { store.close(); }
});

for (const failure of ['read-error', 'wrong-id', 'wrong-capture', 'wrong-currency'] as const) {
  test(`a ${failure} while checking a failed refund cannot restore fulfillment or issue a replacement operation`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      await engine.capture('kasia', current(engine).id); const count = f.writes.length;
      f.hooks.refundRead = async id => {
        if (failure === 'read-error') throw new Error('Refund read unavailable');
        return { providerId: failure === 'wrong-id' ? 'UNRELATED-REFUND' : id, status: 'FAILED',
          ...(failure === 'wrong-capture' ? { captureId: 'UNRELATED-CAPTURE' } : {}),
          ...(failure === 'wrong-currency' ? { amountCents: 38000, currency: 'USD' } : {}) };
      };
      await engine.verifiedWebhook({ ...refundEvent(`refund-${failure}`), event_type: 'PAYMENT.REFUND.FAILED' });
      assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(current(engine).status, 'reconciling');
      assert.equal(f.writes.length, count);
      f.hooks.refundRead = async id => ({ providerId: id, status: 'FAILED' });
      await engine.reconcile('kasia');
      assert.equal(engine.view('kasia').gates.packing.allowed, true); assert.equal(current(engine).status, 'paid');
      assert.equal(f.writes.length, count);
    } finally { store.close(); }
  });
}

test('a failed refund cannot clear a separately received adverse capture reversal whose GET still lags', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    await engine.capture('kasia', current(engine).id); const count = f.writes.length;
    await engine.verifiedWebhook(event('independent-reversal', 'PAYMENT.CAPTURE.REVERSED', 'C1'));
    f.hooks.refundRead = async id => ({ providerId: id, status: 'FAILED' });
    await engine.verifiedWebhook({ ...refundEvent('failed-refund-after-reversal'), event_type: 'PAYMENT.REFUND.FAILED' });
    assert.equal(engine.view('kasia').gates.packing.allowed, false); assert.equal(current(engine).status, 'reconciling');
    assert.equal((engine.view('maja') as BuyerView).plan?.payment.capture?.status, 'UNKNOWN');
    assert.equal(f.writes.length, count);
  } finally { store.close(); }
});

for (const delivery of ['webhook', 'poll'] as const) {
  test(`a capture declined via ${delivery} checks its separate hold and blocks a new purchase until cancellation is confirmed`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      const capture = f.provider.captureAuthorization;
      f.provider.captureAuthorization = async (id, cents, currency, key) => {
        const result = await capture(id, cents, currency, key);
        return id === 'A2' ? { ...result, status: 'PENDING' } : result;
      };
      await engine.capture('kasia', current(engine).id);
      f.captures.set('C2', { ...f.captures.get('C2')!, status: 'FAILED', rawStatus: 'DECLINED' });
      f.hooks.authorizationRead = async id => { if (id === 'A2') throw new Error('Hold status unavailable'); return { ...f.authorizations.get(id)! }; };
      if (delivery === 'webhook') await engine.verifiedWebhook(event('pending-then-declined', 'PAYMENT.CAPTURE.DECLINED', 'C2'));
      else await engine.reconcile('kasia');
      assert.equal(current(engine).status, 'failed');
      assert.ok(f.reads.includes('authorize:A2'), 'a failed capture is not evidence that its authorization was cancelled');
      assert.deepEqual(f.writes.filter(w => w.kind === 'refund').map(w => w.id), ['C1']);
      assert.deepEqual(f.writes.filter(w => w.kind === 'void').map(w => w.id), ['A3', 'A4']);
      assert.equal(engine.view('kasia').gates.solve.allowed, false);
      assert.throws(() => engine.solve('kasia'), code('GATE_CLOSED'));
      delete f.hooks.authorizationRead;
      const reloaded = new LotSplitEngine(store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
      assert.equal(reloaded.view('kasia').gates.solve.allowed, false);
      await reloaded.reconcile('kasia'); await reloaded.reconcile('kasia');
      assert.deepEqual(f.writes.filter(w => w.kind === 'void').map(w => w.id).sort(), ['A2', 'A3', 'A4']);
      assert.equal(f.authorizations.get('A2')?.status, 'VOIDED');
      assert.equal(reloaded.view('kasia').gates.solve.allowed, true);
      reloaded.solve('kasia'); const replacement = current(reloaded); reloaded.sendPlan('kasia', replacement.id);
      for (const a of replacement.assignments) reloaded.agree(a.buyerId, replacement.id, a.termsDigest);
      assert.deepEqual((reloaded.view('kasia') as OrganizerView).priorPaymentBlockers, []);
      assert.equal(reloaded.view('ola').gates.authorize.allowed, true);
    } finally { store.close(); }
  });
}

async function pendingAuthorization() {
  const f = await fixture(1); const { engine } = f; const plan = current(engine);
  const authorize = f.provider.authorizeOrder;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.provider.authorizeOrder = async (id, key) => {
    const result = await authorize(id, key);
    if (id === 'O2') { entered.resolve(); await release.promise; }
    return result;
  };
  const second = plan.assignments[1].buyerId;
  const order = await engine.authorize(second, plan.id); const approval = engine.approve(second, order.operationId);
  await entered.promise;
  for (const a of plan.assignments.slice(2)) { const other = await engine.authorize(a.buyerId, plan.id); await engine.approve(a.buyerId, other.operationId); }
  return { ...f, second, order, approval, release };
}

for (const [parent, read] of [
  [{ order_id: 'O3' }, 'spent'], [{ authorization_id: 'A3' }, 'lagged'],
  [{ order_id: 'O3', authorization_id: 'A3' }, 'unavailable'],
] as const) {
  test(`a foreign capture reported by a saved parent freezes this group for manual review (parent GET: ${read})`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      const plan = current(engine), count = f.writes.length;
      const hold = f.authorizations.get('A3')!;
      f.orders.get('O3')!.captureId = 'C-EXTERNAL';
      f.authorizations.set('A3', { ...hold, status: 'UNKNOWN', rawStatus: 'CAPTURED' });
      f.hooks.authorizationRead = async id => {
        assert.equal(engine.view('kasia').gates.capture.allowed, false);
        if (read === 'unavailable') throw new Error('Provider unavailable');
        return { ...(read === 'lagged' ? hold : f.authorizations.get(id)!) };
      };
      const notice = event('foreign-capture', 'PAYMENT.CAPTURE.COMPLETED', 'C-EXTERNAL', parent);
      await engine.verifiedWebhook(notice);
      assert.equal(engine.view('kasia').gates.capture.allowed, false);
      assert.equal(engine.view('kasia').progress.authorizations, 3);
      assert.ok(f.reads.includes('authorize:A3') || f.reads.includes('order:O3'));
      assert.match((engine.view('bartek') as BuyerView).plan!.payment.authorization!.lastError!, /manual/i);
      const after = f.reads.length;
      const reloaded = new LotSplitEngine(store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
      await reloaded.verifiedWebhook(notice); assert.equal(f.reads.length, after);
      delete f.hooks.authorizationRead; await reloaded.reconcile('kasia');
      await assert.rejects(reloaded.capture('kasia', plan.id), code('GATE_CLOSED'));
      assert.equal(reloaded.view('kasia').gates.packing.allowed, false);
      assert.equal(reloaded.view('kasia').gates.solve.allowed, false);
      assert.equal(f.writes.length, count); assert.equal(current(reloaded).payments.bartek!.captureOperationId, undefined);
    } finally { store.close(); }
  });
}

test('unrelated and conflicting capture parents cannot revoke another buyer’s hold', async () => {
  const f = await fixture();
  try {
    for (const [i, parent] of [undefined, { order_id: 'OUTSIDE' }, { authorization_id: 'OUTSIDE' }, { order_id: 'O2', authorization_id: 'A3' }].entries())
      await f.engine.verifiedWebhook(event(`unrelated-capture-${i}`, 'PAYMENT.CAPTURE.COMPLETED', 'C-EXTERNAL', parent));
    assert.equal(f.engine.view('kasia').gates.capture.allowed, true);
    assert.deepEqual(f.reads, []);
  } finally { f.store.close(); }
});

test('a different capture on the very same hold while its POST is in flight cannot be silently discarded', async () => {
  const f = await fixture();
  try {
    f.hooks.captured = async id => {
      if (id === 'A1') await f.engine.verifiedWebhook(event('two-captures-one-order', 'PAYMENT.CAPTURE.COMPLETED', 'FOREIGN', { order_id: 'O1' }));
    };
    await f.engine.capture('kasia', current(f.engine).id);
    const capture = f.engine.snapshot().operations[current(f.engine).payments.maja!.captureOperationId!];
    assert.equal(capture.providerId, 'C1'); assert.equal(capture.status, 'COMPLETED');
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1']);
    assert.equal(f.writes.some(w => w.kind === 'refund'), false);
    assert.equal(f.engine.view('kasia').gates.packing.allowed, false);
  } finally { f.store.close(); }
});

test('a matching order-only capture hint lets the saved POST confirm its own capture and the group finish', async () => {
  const f = await fixture();
  try {
    f.hooks.captured = async (id, result) => {
      if (id === 'A1') await f.engine.verifiedWebhook(event('own-early-capture', 'PAYMENT.CAPTURE.COMPLETED', result.providerId, { order_id: 'O1' }));
    };
    await f.engine.capture('kasia', current(f.engine).id);
    assert.equal(current(f.engine).status, 'paid'); assert.equal(f.engine.view('kasia').gates.packing.allowed, true);
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1', 'A2', 'A3', 'A4']);
    await f.engine.verifiedWebhook(event('second-child-after-payment', 'PAYMENT.CAPTURE.PENDING', 'FOREIGN', { order_id: 'O1' }));
    assert.equal(f.engine.view('kasia').gates.packing.allowed, false);
    assert.equal(f.writes.some(w => w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

test('a foreign charge on a known order before its local authorization blocks the approval callback', async () => {
  const f = await fixture(2);
  try {
    const order = await f.engine.authorize('bartek', current(f.engine).id); const count = f.writes.length;
    await f.engine.verifiedWebhook(event('owned-order-only', 'PAYMENT.CAPTURE.COMPLETED', 'FOREIGN', { order_id: 'O3' }));
    assert.deepEqual(f.reads, ['order:O3']);
    await assert.rejects(f.engine.approve('bartek', order.operationId), code('GATE_CLOSED'));
    assert.match((f.engine.view('bartek') as BuyerView).plan!.payment.order!.lastError!, /manual/i);
    assert.equal(f.writes.length, count);
  } finally { f.store.close(); }
});

async function withSupersededOrder(nextPlan = false) {
  const f = await fixture(0); const { engine } = f;
  const first = await engine.authorize('maja', current(engine).id);
  engine.cancelPayment('maja', first.operationId);
  if (nextPlan) {
    engine.solve('kasia'); const plan = current(engine); engine.sendPlan('kasia', plan.id);
    for (const a of plan.assignments) engine.agree(a.buyerId, plan.id, a.termsDigest);
  }
  const plan = current(engine);
  for (const a of plan.assignments) { const order = await engine.authorize(a.buyerId, plan.id); await engine.approve(a.buyerId, order.operationId); }
  assert.equal(engine.view('kasia').gates.capture.allowed, true);
  assert.notEqual(current(engine).payments.maja?.orderOperationId, first.operationId);
  f.orders.set('O1', { ...f.orders.get('O1')!, status: 'COMPLETED', captureId: 'FOREIGN' });
  return { ...f, first, notice: event('historical-payment', 'PAYMENT.CAPTURE.COMPLETED', 'FOREIGN', { order_id: 'O1' }) };
}

test('review of a replaced order prevents the first and subsequent capture requests for this plan', async () => {
  for (const duringCapture of [false, true]) {
    const f = await withSupersededOrder();
    try {
      if (duringCapture) {
        f.hooks.captured = async id => { if (id === 'A1') await f.engine.verifiedWebhook(f.notice); };
        await f.engine.capture('kasia', current(f.engine).id);
      } else {
        await f.engine.verifiedWebhook(f.notice);
        await assert.rejects(f.engine.capture('kasia', current(f.engine).id), code('GATE_CLOSED'));
      }
      assert.equal(f.engine.snapshot().operations[f.first.operationId].status, 'CANCELLED');
      assert.equal(f.engine.snapshot().paymentObservations![f.first.operationId].unattributedCapture?.resourceId, 'FOREIGN');
      const again = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
      await again.verifiedWebhook(f.notice); await again.reconcile('kasia');
      assert.equal(again.view('kasia').gates.capture.allowed, false);
      assert.equal(again.view('kasia').gates.packing.allowed, false);
      assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), duringCapture ? ['A1'] : []);
      assert.equal(f.writes.some(w => w.kind === 'refund'), false);
    } finally { f.store.close(); }
  }
});

test('review of a cancelled order from an earlier plan pauses pickup for the paid replacement plan', async () => {
  const f = await withSupersededOrder(true);
  try {
    const { engine } = f, plan = current(engine); await engine.capture('kasia', plan.id);
    engine.updatePacking('kasia', 'maja', { checkedItemIds: plan.assignments[0].itemIds, packed: true });
    const history = structuredClone(engine.snapshot().packing), count = f.writes.length;
    await engine.verifiedWebhook(f.notice); await engine.reconcile('kasia');
    const view = engine.view('kasia') as OrganizerView;
    assert.ok(view.priorPaymentBlockers.some(blocker => blocker.operations.some(op => op.id === f.first.operationId)));
    assert.equal(view.gates.packing.allowed, false);
    assert.deepEqual(view.packing, []); assert.deepEqual(engine.snapshot().packing, history);
    assert.throws(() => engine.updatePacking('kasia', 'ola', { checkedItemIds: plan.assignments[1].itemIds, packed: true }), code('GATE_CLOSED'));
    assert.equal(f.writes.length, count);
  } finally { f.store.close(); }
});

test('a change to a superseded order blocks before its GET and preserves evidence of multiple captures across restart', async () => {
  const f = await withSupersededOrder();
  try {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const amount = { value: '380.00', currency_code: 'PLN' };
    const adapter = new PayPalSandboxProvider({ clientId: 'fixture', clientSecret: 'fixture', fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-token', expires_in: 3600 });
      assert.equal(path, '/v2/checkout/orders/O1'); await waiting;
      return Response.json({ id: 'O1', intent: 'AUTHORIZE', status: 'COMPLETED', purchase_units: [{ amount, payments: {
        authorizations: [{ id: 'OLD-A', status: 'CAPTURED', amount }],
        captures: ['100.00', '280.00'].map((value, i) => ({ id: `FOREIGN-${i}`, status: 'COMPLETED', amount: { ...amount, value } })),
      } }] });
    } });
    f.provider.getOrder = adapter.getOrder.bind(adapter);
    const receiving = f.engine.verifiedWebhook(event('historical-approved', 'CHECKOUT.ORDER.APPROVED', 'O1'));
    const allowedDuringRead = f.engine.view('kasia').gates.capture.allowed;
    release(); await receiving;
    assert.equal(allowedDuringRead, false);
    const reloaded = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    f.provider.getOrder = async () => ({ providerId: 'O1', status: 'APPROVED', amountCents: 38000, currency: 'PLN' });
    await reloaded.reconcile('kasia');
    await assert.rejects(reloaded.capture('kasia', current(reloaded).id), code('GATE_CLOSED'));
    assert.equal(reloaded.view('kasia').gates.packing.allowed, false);
    assert.equal(reloaded.snapshot().operations[f.first.operationId].status, 'CANCELLED');
    assert.equal(f.writes.some(w => w.kind === 'capture' || w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

test('a transient unreadable historical order is checked read-only and a confirmed clean order releases the group', async () => {
  const f = await withSupersededOrder();
  try {
    f.provider.getOrder = async () => { throw new Error('Sandbox response unavailable'); };
    await f.engine.verifiedWebhook(event('unread-historical', 'CHECKOUT.ORDER.APPROVED', 'O1'));
    const reloaded = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    assert.equal(reloaded.view('kasia').gates.capture.allowed, false);
    const before = f.writes.length;
    f.provider.getOrder = async () => ({ providerId: 'O1', status: 'APPROVED', amountCents: 38000, currency: 'PLN' });
    await reloaded.reconcile('kasia');
    assert.equal(reloaded.view('kasia').gates.capture.allowed, true);
    assert.equal(f.writes.length, before);
  } finally { f.store.close(); }
});

test('a second order notice cannot reopen the group while an earlier read of its payment list is outstanding', async () => {
  const f = await withSupersededOrder();
  try {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    let count = 0;
    f.provider.getOrder = async id => {
      if (++count === 1) { await waiting; throw new PayPalProviderError('UNEXPECTED_PAYMENT_COUNT', 'Two capture receipts', true); }
      return { providerId: id, status: 'APPROVED', amountCents: 38000, currency: 'PLN' };
    };
    const first = f.engine.verifiedWebhook(event('notice-one', 'CHECKOUT.ORDER.APPROVED', 'O1'));
    const second = f.engine.verifiedWebhook(event('notice-two', 'CHECKOUT.ORDER.COMPLETED', 'O1'));
    await new Promise<void>(resolve => setImmediate(resolve));
    const ready = f.engine.view('kasia').gates.capture.allowed;
    release(); await Promise.all([first, second]);
    assert.equal(ready, false); assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    assert.equal(f.writes.some(w => w.kind === 'capture'), false);
  } finally { f.store.close(); }
});

for (const failedSecond of [false, true]) test(`an unproven pre-invoice capture cannot authorize collection, preparation or a refund (second fails ${failedSecond})`, async () => {
  const f = await fixture(); const oldStore = new SqliteStore<DomainState>(':memory:');
  try {
    const send = f.provider.captureAuthorization;
    f.provider.captureAuthorization = async (...args) => {
      const receipt = await send(...args);
      return args[0] === 'A2' ? { ...receipt, status: 'PENDING' } : receipt;
    };
    await f.engine.capture('kasia', current(f.engine).id);
    // Shape emitted by 013f8cc after GET order -> GET external child -> COMPLETED,
    // with the second buyer still pending. The old format stored no provenance.
    const legacy = f.engine.snapshot(), payments = current(f.engine).payments;
    const first = legacy.operations[payments.maja!.captureOperationId!];
    first.providerId = 'EXTERNAL-RECEIPT'; first.reconcileAttempts = 1;
    for (const capture of [first, legacy.operations[payments.ola!.captureOperationId!]]) {
      const command = legacy.paymentCommands![capture.id];
      legacy.paymentCommands![capture.id] = { attempts: 1, command: { kind: 'capture', providerId: capture.parentProviderId!,
        amountCents: capture.amountCents, currency: capture.currency, idempotencyKey: capture.idempotencyKey } };
      assert.equal(command.command.kind, 'capture');
    }
    oldStore.initialize(legacy); const before = f.writes.length;
    const upgraded = new LotSplitEngine(oldStore, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    f.captures.set('C2', { ...f.captures.get('C2')!, status: failedSecond ? 'FAILED' : 'COMPLETED' });
    await upgraded.reconcile('kasia');
    assert.deepEqual(f.writes.slice(before), []);
    assert.equal(upgraded.view('kasia').gates.packing.allowed, false);
    assert.equal((upgraded.view('maja') as BuyerView).plan!.payment.capture!.status, 'UNKNOWN');
    assert.deepEqual(upgraded.snapshot().operations[first.id], first);
    assert.deepEqual(upgraded.snapshot().paymentCommands![first.id], legacy.paymentCommands![first.id]);
  } finally { f.store.close(); oldStore.close(); }
});

test('an already paid historical plan cannot prepare goods against an ambiguous pre-invoice capture', async () => {
  const f = await fixture(); const previous = new SqliteStore<DomainState>(':memory:');
  try {
    const plan = current(f.engine); await f.engine.capture('kasia', plan.id);
    const legacy = f.engine.snapshot(), first = legacy.operations[current(f.engine).payments.maja!.captureOperationId!];
    const command = legacy.paymentCommands![first.id]; assert.equal(command.command.kind, 'capture');
    first.reconcileAttempts = 1; delete command.command.invoiceId; delete command.captureReceiptId;
    previous.initialize(legacy);
    const upgraded = new LotSplitEngine(previous, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    assert.equal(current(upgraded).status, 'paid');
    assert.equal(upgraded.view('kasia').gates.packing.allowed, false);
    assert.throws(() => upgraded.updatePacking('kasia', 'maja', { checkedItemIds: plan.assignments[0].itemIds, packed: true }), code('GATE_CLOSED'));
    assert.deepEqual(upgraded.snapshot().packing, legacy.packing);
    assert.deepEqual(upgraded.snapshot().operations, legacy.operations);
  } finally { f.store.close(); previous.close(); }
});

for (const laterFailure of [false, true]) {
  test(`a lost capture response followed by an unrelated payment on its order cannot adopt or refund that charge (later failure ${laterFailure})`, async () => {
    const f = await fixture();
    try {
      const original = f.provider.captureAuthorization;
      f.provider.captureAuthorization = async (id, cents, currency, key) => {
        if (id === 'A1') { f.writes.push({ kind: 'capture', id, key }); throw new PayPalProviderError('LOST', 'Request did not reach provider', true); }
        if (laterFailure && id === 'A2') { f.writes.push({ kind: 'capture', id, key }); throw new PayPalProviderError('DECLINED', 'Definitive rejection', false); }
        return original(id, cents, currency, key);
      };
      await f.engine.capture('kasia', current(f.engine).id);
      f.orders.get('O1')!.captureId = 'FOREIGN';
      f.captures.set('FOREIGN', { providerId: 'FOREIGN', status: 'COMPLETED', authorizationId: 'A1', orderId: 'O1',
        amountCents: 38000, currency: 'PLN', ...(laterFailure ? { invoiceId: 'OTHER-MERCHANT-COMMAND' } : {}) });
      await f.engine.reconcile('kasia');
      await f.engine.verifiedWebhook(event('external-after-reconcile', 'PAYMENT.CAPTURE.COMPLETED', 'FOREIGN', { order_id: 'O1' }));
      const op = f.engine.snapshot().operations[current(f.engine).payments.maja!.captureOperationId!];
      assert.equal(op.providerId, undefined); assert.equal(op.status, 'UNKNOWN');
      assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1']);
      assert.equal(f.writes.some(w => w.kind === 'refund' || w.kind === 'void'), false);
      assert.equal(f.engine.view('kasia').gates.packing.allowed, false);
    } finally { f.store.close(); }
  });
}

test('the exact capture receipt for a lost local command allows its group to finish without sending that command twice', async () => {
  const f = await fixture();
  try {
    f.hooks.captured = async id => { if (id === 'A1') throw new PayPalProviderError('LOST', 'Response lost after capture', true); };
    await f.engine.capture('kasia', current(f.engine).id);
    const operationId = current(f.engine).payments.maja!.captureOperationId!;
    assert.equal(f.engine.snapshot().operations[operationId].providerId, undefined);
    assert.ok(f.captures.get('C1')!.invoiceId);
    const reloaded = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    await reloaded.reconcile('kasia');
    assert.equal(reloaded.snapshot().operations[operationId].providerId, 'C1');
    assert.equal(reloaded.view('kasia').gates.packing.allowed, true);
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1', 'A2', 'A3', 'A4']);
  } finally { f.store.close(); }
});

for (const beforeFailure of [true, false]) test(`a matching signed capture hint and a lost POST (hint before loss ${beforeFailure}) recover solely from the command invoice`, async () => {
  const f = await fixture();
  try {
    const notice = event('own-capture-before-receipt', 'PAYMENT.CAPTURE.COMPLETED', 'C1', { order_id: 'O1', authorization_id: 'A1' });
    f.hooks.captured = async id => {
      if (id !== 'A1') return;
      if (beforeFailure) await f.engine.verifiedWebhook(notice);
      throw new PayPalProviderError('LOST', 'Capture response lost', true);
    };
    await f.engine.capture('kasia', current(f.engine).id);
    if (!beforeFailure) await f.engine.verifiedWebhook(notice);
    const reloaded = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    await reloaded.reconcile('kasia'); await reloaded.reconcile('kasia');
    assert.equal(reloaded.snapshot().operations[current(reloaded).payments.maja!.captureOperationId!].providerId, 'C1');
    assert.equal(reloaded.view('kasia').gates.packing.allowed, true);
    assert.ok(f.reads.includes('order:O1') && f.reads.includes('capture:C1'));
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1', 'A2', 'A3', 'A4']);
  } finally { f.store.close(); }
});

test('an already spent hold reported by the order during authorization recovery cannot be overwritten by a lagging authorization GET', async () => {
  const f = await fixture(3);
  try {
    const buyer = current(f.engine).assignments[3].buyerId;
    f.provider.authorizeOrder = async () => { throw new PayPalProviderError('LOST', 'Approval response lost', true); };
    const order = await f.engine.authorize(buyer, current(f.engine).id);
    const auth = await f.engine.approve(buyer, order.operationId);
    const owned = f.orders.get('O4')!;
    Object.assign(owned, { authorizationId: 'AF', authorizationRawStatus: 'PARTIALLY_CAPTURED' });
    f.authorizations.set('AF', { providerId: 'AF', orderId: 'O4', status: 'AUTHORIZED', amountCents: owned.amountCents, currency: 'PLN' });
    await f.engine.reconcile('kasia', auth.operationId);
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    assert.ok(f.engine.snapshot().paymentObservations![order.operationId].unattributedCapture);
    assert.equal(f.writes.some(w => w.kind === 'capture' || w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

for (const partial of [false, true]) test(`an existing ${partial ? 'partial' : 'full'} capture in the authorization callback order remains evidence even if the separate authorization read lags`, async () => {
  const f = await fixture(3);
  try {
    const buyer = current(f.engine).assignments[3].buyerId, amount = { value: (current(f.engine).assignments[3].totalCents / 100).toFixed(2), currency_code: 'PLN' };
    const paths: string[] = [];
    const adapter = new PayPalSandboxProvider({ clientId: 'fixture', clientSecret: 'fixture', fetch: async (url, init) => {
      const path = new URL(String(url)).pathname; paths.push(path);
      if (path === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-token', expires_in: 3600 });
      if (path === '/v2/checkout/orders/O4') return Response.json({ id: 'O4', intent: 'AUTHORIZE', status: 'COMPLETED',
        purchase_units: [{ amount, payments: { authorizations: [{ id: 'AF', status: partial ? 'PARTIALLY_CAPTURED' : 'CAPTURED', amount }],
          captures: [{ id: 'FF', status: 'COMPLETED', amount: partial ? { ...amount, value: '1.00' } : amount }] } }] });
      if (path === '/v2/payments/authorizations/AF') return Response.json({ id: 'AF', status: 'CREATED', amount });
      throw new Error(`Unexpected ${init?.method} ${path}`);
    } });
    const order = await f.engine.authorize(buyer, current(f.engine).id);
    f.provider.authorizeOrder = adapter.authorizeOrder.bind(adapter);
    await f.engine.approve(buyer, order.operationId);
    assert.ok(paths.includes('/v2/checkout/orders/O4'));
    assert.equal(f.engine.snapshot().paymentObservations?.[order.operationId]?.unattributedCapture?.resourceId, 'FF');
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    await f.engine.reconcile('kasia');
    await assert.rejects(f.engine.capture('kasia', current(f.engine).id), code('GATE_CLOSED'));
    assert.equal(current(f.engine).payments[buyer]!.captureOperationId, undefined);
    assert.equal(f.writes.some(w => w.kind === 'capture' || w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

test('an exact order read reporting an external capture requires review even if the separate hold read still lags', async () => {
  const f = await fixture();
  try {
    f.orders.get('O3')!.captureId = 'C-EXTERNAL';
    await f.engine.verifiedWebhook(event('order-reports-external-capture', 'CHECKOUT.ORDER.COMPLETED', 'O3'));
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    assert.match((f.engine.view('bartek') as BuyerView).plan!.payment.authorization!.lastError!, /manual/i);
    assert.equal(current(f.engine).payments.bartek!.captureOperationId, undefined);
    assert.equal(f.writes.some(w => w.kind === 'capture' || w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

for (const invoiceId of [undefined, 'OTHER-INVOICE']) test(`a signed parent hint cannot assign a foreign receipt with ${invoiceId ? 'another' : 'no'} invoice`, async () => {
  const f = await fixture();
  try {
    f.hooks.captured = async () => {
      f.orders.get('O1')!.captureId = 'FOREIGN';
      f.captures.set('FOREIGN', { providerId: 'FOREIGN', status: 'COMPLETED', amountCents: 38000, currency: 'PLN', invoiceId });
      await f.engine.verifiedWebhook(event('possible-other-charge', 'PAYMENT.CAPTURE.COMPLETED', 'FOREIGN', { order_id: 'O1' }));
      throw new PayPalProviderError('UNAVAILABLE', 'Response lost', true);
    };
    await f.engine.capture('kasia', current(f.engine).id); await f.engine.reconcile('kasia');
    const capture = f.engine.snapshot().operations[current(f.engine).payments.maja!.captureOperationId!];
    assert.equal(capture.providerId, undefined);
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1']);
    assert.ok(f.reads.indexOf('order:O1') >= 0 && f.reads.indexOf('capture:FOREIGN') > f.reads.indexOf('order:O1'));
    assert.equal(f.engine.view('kasia').gates.packing.allowed, false);
    assert.equal(f.writes.some(w => w.kind === 'refund'), false);
  } finally { f.store.close(); }
});

test('proving the lost receipt by invoice does not clear a separate child reported on the same hold', async () => {
  const f = await fixture();
  try {
    f.hooks.captured = async id => {
      if (id !== 'A1') return;
      for (const child of ['C1', 'ANOTHER-CHILD'])
        await f.engine.verifiedWebhook(event(`hint-${child}`, 'PAYMENT.CAPTURE.COMPLETED', child, { order_id: 'O1', authorization_id: 'A1' }));
      throw new PayPalProviderError('LOST', 'Capture response lost', true);
    };
    await f.engine.capture('kasia', current(f.engine).id); await f.engine.reconcile('kasia');
    const payment = current(f.engine).payments.maja!, state = f.engine.snapshot();
    assert.equal(state.operations[payment.captureOperationId!].providerId, 'C1');
    assert.equal(state.paymentObservations![payment.authorizationOperationId!].unattributedCapture?.resourceId, 'ANOTHER-CHILD');
    assert.deepEqual(f.writes.filter(w => w.kind === 'capture').map(w => w.id), ['A1']);
    assert.equal(f.reads.includes('capture:ANOTHER-CHILD'), false); assert.equal(f.engine.view('kasia').gates.packing.allowed, false);
  } finally { f.store.close(); }
});

test('an authorization callback that sees multiple payments cannot later recover a spendable hold from a lagging order', async () => {
  const f = await fixture(3);
  try {
    const buyer = current(f.engine).assignments[3].buyerId;
    const order = await f.engine.authorize(buyer, current(f.engine).id);
    f.provider.authorizeOrder = async () => { throw new PayPalProviderError('UNEXPECTED_PAYMENT_COUNT', 'Multiple captures on the exact order', true); };
    const auth = await f.engine.approve(buyer, order.operationId);
    const owned = f.orders.get('O4')!; owned.authorizationId = 'AF';
    f.authorizations.set('AF', { providerId: 'AF', orderId: 'O4', status: 'AUTHORIZED', amountCents: owned.amountCents, currency: owned.currency });
    await f.engine.reconcile('kasia', auth.operationId);
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false);
    assert.equal(f.engine.snapshot().paymentObservations![order.operationId].unattributedCapture?.resourceId, 'O4');
  } finally { f.store.close(); }
});

for (const related of [false, true]) {
  test(`a received early authorization void (${related ? 'order up link' : 'resource ID only'}) closes collection before its late successful response can open it`, async () => {
    const f = await pendingAuthorization(); const { engine, store, release } = f;
    try {
      const notification = event('early-void', 'PAYMENT.AUTHORIZATION.VOIDED', 'A2');
      if (related) Object.assign(notification.resource, { links: [{ rel: 'up', href: 'https://api.sandbox.paypal.com/v2/checkout/orders/O2' }] });
      f.authorizations.set('A2', { ...f.authorizations.get('A2')!, status: 'VOIDED' });
      f.hooks.authorizationRead = async id => {
        assert.equal(engine.view('kasia').gates.capture.allowed, false);
        return { ...f.authorizations.get(id)! };
      };
      await engine.verifiedWebhook(notification); release.resolve(); const approval = await f.approval;
      await engine.verifiedWebhook(notification);
      assert.ok(f.reads.includes('authorize:A2')); assert.equal(engine.view('kasia').gates.capture.allowed, false);
      assert.equal(engine.snapshot().operations[approval.operationId].status, 'AUTHORIZED', 'retain the command response in history');
      assert.equal((engine.view(f.second) as BuyerView).plan?.payment.authorization?.status, 'VOIDED');
      await assert.rejects(engine.capture('kasia', current(engine).id), code('GATE_CLOSED'));
      assert.equal((await engine.approve(f.second, f.order.operationId)).operationId, approval.operationId);
      assert.equal(f.writes.filter(w => w.kind === 'authorize').length, 4); assert.equal(f.writes.some(w => w.kind === 'capture'), false);
    } finally { release.resolve(); await f.approval; store.close(); }
  });
}

test('an unrelated authorization while the command is outstanding never replaces its real ID, even when the event names the same order', async () => {
  const f = await pendingAuthorization();
  try {
    await f.engine.verifiedWebhook(event('wrong-hold', 'PAYMENT.AUTHORIZATION.VOIDED', 'A-OTHER', { order_id: 'O2' }));
    f.release.resolve(); const result = await f.approval;
    assert.equal(f.engine.snapshot().operations[result.operationId].providerId, 'A2');
    assert.equal(f.engine.view('kasia').gates.capture.allowed, true);
    assert.equal(f.reads.includes('authorize:A-OTHER'), false);
  } finally { f.release.resolve(); await f.approval; f.store.close(); }
});

test('an early void survives a restart and a missing child on order GET; even a read before the POST returns preserves both facts', async () => {
  const f = await pendingAuthorization();
  try {
    const id = current(f.engine).payments[f.second]!.authorizationOperationId!;
    f.authorizations.set('A2', { ...f.authorizations.get('A2')!, status: 'VOIDED' });
    await f.engine.verifiedWebhook(event('durable-early-void', 'PAYMENT.AUTHORIZATION.VOIDED', 'A2'));
    const reloaded = new LotSplitEngine(f.store, { conceptVersion: 2, mode: 'sandbox', now: () => NOW, paymentProvider: f.provider });
    const readOrder = f.provider.getOrder;
    f.provider.getOrder = async id => { const order = await readOrder(id); delete order.authorizationId; return order; };
    await reloaded.reconcile('kasia', id);
    assert.equal(reloaded.view('kasia').gates.capture.allowed, false);
    assert.equal(f.writes.filter(w => w.kind === 'authorize').length, 4);
    f.provider.getOrder = readOrder; await reloaded.reconcile('kasia', id);
    assert.equal((reloaded.view(f.second) as BuyerView).plan?.payment.authorization?.status, 'VOIDED');
    f.release.resolve(); await f.approval;
    assert.equal(reloaded.snapshot().operations[id].status, 'AUTHORIZED', 'the delayed POST has its own immutable history');
    assert.equal((reloaded.view(f.second) as BuyerView).plan?.payment.authorization?.status, 'VOIDED');
    assert.equal(reloaded.view('kasia').gates.capture.allowed, false); assert.ok(f.reads.includes('authorize:A2'));
    assert.equal(f.writes.some(w => w.kind === 'capture'), false);
  } finally { f.release.resolve(); await f.approval; f.store.close(); }
});

test('too many early authorization hints pause collection, and checking only reads the proven hold', async () => {
  const f = await pendingAuthorization();
  try {
    for (let i = 0; i < 30; i++) await f.engine.verifiedWebhook(event(`early-noise-${i}`, 'PAYMENT.AUTHORIZATION.VOIDED', `OTHER-${i}`));
    const hints = Object.values(f.engine.snapshot().pendingResourceChanges!);
    assert.equal(hints.length, 1); assert.ok(hints[0].changes.length <= 16); assert.equal(hints[0].overflow, true);
    f.release.resolve(); await f.approval; await f.engine.verifiedWebhook(event('created-after-overflow', 'PAYMENT.AUTHORIZATION.CREATED', 'A2'));
    assert.equal((f.engine.view(f.second) as BuyerView).plan?.payment.authorization?.status, 'UNKNOWN');
    assert.equal(f.engine.view('kasia').gates.capture.allowed, false); assert.ok(f.reads.every(r => r === 'authorize:A2'));
    assert.equal(f.writes.filter(w => w.kind === 'authorize').length, 4); assert.equal(f.writes.some(w => w.kind === 'capture'), false);
  } finally { f.release.resolve(); await f.approval; f.store.close(); }
});

test('a matching early refund settles its original command only after the POST identifies it', async () => {
  const f = await fixture(); const { engine, store } = f;
  try {
    const capture = f.provider.captureAuthorization;
    f.provider.captureAuthorization = async (id, cents, currency, key) => id === 'A2' ? { providerId: 'C2', status: 'FAILED', amountCents: cents, currency } : capture(id, cents, currency, key);
    f.hooks.refundRead = async id => ({ providerId: id, status: 'COMPLETED', captureId: 'C1', amountCents: 38000, currency: 'PLN' });
    let providerIdBeforeResponse: string | undefined = 'not exercised';
    f.provider.refundCapture = async (id, cents, currency, key) => {
      f.writes.push({ kind: 'refund', id, amountCents: cents, key });
      await engine.verifiedWebhook(event('local-refund-early', 'PAYMENT.REFUND.COMPLETED', 'R-LOCAL', { capture_id: id }));
      providerIdBeforeResponse = engine.snapshot().operations[current(engine).payments.maja!.refundOperationId!].providerId;
      return { providerId: 'R-LOCAL', status: 'PENDING', captureId: id, amountCents: cents, currency };
    };
    await engine.capture('kasia', current(engine).id);
    const localId = current(engine).payments.maja!.refundOperationId!;
    assert.equal(providerIdBeforeResponse, undefined);
    assert.equal(engine.snapshot().operations[localId].providerId, 'R-LOCAL');
    assert.equal(engine.snapshot().operations[localId].status, 'COMPLETED');
    f.captures.set('C1', { ...f.captures.get('C1')!, status: 'UNKNOWN', rawStatus: 'REFUNDED' });
    await engine.reconcile('kasia'); await assert.rejects(engine.retryCompensation('kasia', localId), code('RETRY_NOT_ALLOWED'));
    assert.deepEqual(f.writes.filter(w => w.kind === 'refund').map(w => w.id), ['C1']);
    assert.equal(engine.view('kasia').gates.solve.allowed, true);
  } finally { store.close(); }
});

for (const [amount, lost] of [[100, false], [38000, false], [38000, true]] as const) {
  test(`another refund of ${amount} cents cannot own a local refund when its response is ${lost ? 'lost' : 'delayed'}`, async () => {
    const f = await fixture(); const { engine, store } = f;
    try {
      const capture = f.provider.captureAuthorization;
      f.provider.captureAuthorization = async (id, cents, currency, key) => id === 'A2' ? { providerId: 'C2', status: 'FAILED', amountCents: cents, currency } : capture(id, cents, currency, key);
      f.hooks.refundRead = async id => ({ providerId: id, status: 'FAILED', captureId: 'C1', amountCents: amount, currency: 'PLN' });
      let beforeResponse: { providerId?: string; status: string } | undefined;
      f.provider.refundCapture = async (id, cents, currency, key) => {
        f.writes.push({ kind: 'refund', id, amountCents: cents, key });
        await engine.verifiedWebhook({ ...refundEvent('different-refund'), event_type: 'PAYMENT.REFUND.FAILED' });
        beforeResponse = engine.snapshot().operations[current(engine).payments.maja!.refundOperationId!];
        if (lost) throw new PayPalProviderError('UNKNOWN_RESULT', 'Response lost', true);
        return { providerId: 'R-LOCAL', status: 'COMPLETED', captureId: id, amountCents: cents, currency };
      };
      await engine.capture('kasia', current(engine).id);
      const localId = current(engine).payments.maja!.refundOperationId!;
      assert.equal(beforeResponse?.providerId, undefined, 'the capture identifies a parent payment, not a refund command');
      assert.ok(f.reads.includes('refund:EXTERNAL-REFUND'));
      const after = engine.snapshot().operations[localId];
      assert.equal(after.providerId, lost ? undefined : 'R-LOCAL'); assert.equal(after.status, lost ? 'UNKNOWN' : 'COMPLETED');
      await assert.rejects(engine.retryCompensation('kasia', localId), code('RETRY_NOT_ALLOWED'));
      await engine.reconcile('kasia'); await engine.reconcile('kasia');
      assert.equal(f.writes.filter(w => w.kind === 'refund').length, 1);
      assert.equal(engine.view('kasia').gates.solve.allowed, !lost);
    } finally { store.close(); }
  });
}
