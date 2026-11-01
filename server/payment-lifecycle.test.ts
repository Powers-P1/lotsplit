import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, LotSplitEngine, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { v2Defaults } from './v2-catalog.js';
import type { BuyerView, OrganizerView } from '../shared/types.js';
import type { PaymentProvider, ProviderResult } from './paypal.js';
import { PayPalProviderError } from './paypal.js';

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

async function fixture() {
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
    async captureAuthorization(id, amountCents, currency, key) {
      writes.push({ kind: 'capture', id, key, amountCents });
      const result: ProviderResult = { providerId: `C${captures.size + 1}`, status: 'COMPLETED', amountCents, currency };
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
  for (const assignment of plan.assignments) {
    const order = await engine.authorize(assignment.buyerId, plan.id); await engine.approve(assignment.buyerId, order.operationId);
  }
  assert.equal(engine.view('kasia').gates.capture.allowed, true);
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
