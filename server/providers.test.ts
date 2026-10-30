import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PayPalSandboxProvider, PayPalProviderError, createPayPalProvider, paypalRequestId } from './paypal.js';
import { AiProviderError, NebiusAiProvider } from './ai.js';

type Call = { url: string; init: RequestInit; body: Record<string, any> };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const money = { value: '180.00', currency_code: 'PLN' };
function paypalMock(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const provider = new PayPalSandboxProvider({ clientId: 'test-client', clientSecret: 'test-secret', webhookId: 'WH-TEST',
    fetch: (async (input, init = {}) => {
      const call = { url: String(input), init, body: init.body && init.headers && new Headers(init.headers).get('content-type') === 'application/json' ? JSON.parse(String(init.body)) : {} };
      calls.push(call);
      if (call.url.endsWith('/v1/oauth2/token')) return json({ access_token: 'test-access-token', expires_in: 3600 });
      return handler(call);
    }) as typeof fetch,
  });
  return { provider, calls };
}
function aiResponse(value: unknown, options: { model?: string; finish?: string } = {}): Response {
  return json({ id: 'chatcmpl-provider-response', model: options.model ?? 'actual-provider-model',
    choices: [{ finish_reason: options.finish ?? 'stop', message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 } });
}
const preferences = { preferredIds: ['01'], alternativeIds: ['02'], rejectedIds: [], maxTotalCents: 20_000,
  noAlternativesExplicit: false, ambiguities: [] };
const catalog = [{ id: '01', name: 'Pierwszy przedmiot' }, { id: '02', name: 'Drugi przedmiot' }];
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const png = `data:image/png;base64,${pngBytes.toString('base64')}`;

test('PayPal cannot select a live host, port, credentials URL, redirect host, or Live mode', () => {
  for (const baseUrl of ['https://api-m.paypal.com', 'https://api-m.sandbox.paypal.com.evil.test',
    'https://user:password@api-m.sandbox.paypal.com', 'https://api-m.sandbox.paypal.com:444', 'https://api-m.sandbox.paypal.com/v1']) {
    assert.throws(() => new PayPalSandboxProvider({ baseUrl }), { code: 'SANDBOX_REQUIRED' });
  }
  assert.throws(() => createPayPalProvider({ PAYPAL_ENVIRONMENT: 'live' }), { code: 'SANDBOX_REQUIRED' });
});

test('PayPal missing credentials is unavailable; no fabricated payment result', async () => {
  const provider = new PayPalSandboxProvider();
  assert.equal(provider.configured, false);
  await assert.rejects(provider.getOrder('ORDER1'), { code: 'PAYPAL_NOT_CONFIGURED', httpStatus: 503 });
});

test('PayPal creates exact AUTHORIZE order, sandbox approval link, stable request key and no capture', async () => {
  const { provider, calls } = paypalMock(call => {
    assert.equal(call.url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
    assert.equal(call.body.intent, 'AUTHORIZE');
    assert.deepEqual(call.body.purchase_units[0].amount, money);
    assert.equal(call.body.payment_source.paypal.experience_context.user_action, 'CONTINUE');
    assert.equal(call.init.redirect, 'error');
    assert.equal(new Headers(call.init.headers).get('paypal-request-id'), paypalRequestId('saved-order-key'));
    return json({ id: 'ORDER1', intent: 'AUTHORIZE', status: 'PAYER_ACTION_REQUIRED', purchase_units: [{ amount: money }],
      links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' }] }, 201);
  });
  const input = { amountCents: 18_000, currency: 'PLN', description: 'Plan v1, własny przydział', customId: 'saved-operation',
    returnUrl: 'http://localhost:4319/api/paypal/return', cancelUrl: 'http://localhost:4319/api/paypal/cancel', idempotencyKey: 'saved-order-key' };
  const result = await provider.createOrder(input);
  assert.equal(result.status, 'CREATED');
  assert.equal(result.amountCents, 18_000);
  assert.match(result.approvalUrl!, /^https:\/\/www\.sandbox\.paypal\.com\//);
  assert.equal(result.trace?.environment, 'sandbox');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.url.includes('/capture')));
  assert.equal(paypalRequestId('saved-order-key'), paypalRequestId('saved-order-key'));
  assert.notEqual(paypalRequestId('saved-order-key'), paypalRequestId('other-order-key'));
  assert.ok(paypalRequestId('a'.repeat(300)).length <= 38);
});

test('PayPal refuses a live buyer approval link even in an otherwise successful response', async () => {
  const { provider } = paypalMock(() => json({ id: 'ORDER1', status: 'CREATED',
    links: [{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow?token=ORDER1' }] }));
  await assert.rejects(provider.createOrder({ amountCents: 18_000, currency: 'PLN', description: 'Plan', customId: 'op',
    returnUrl: 'http://localhost/return', cancelUrl: 'http://localhost/cancel', idempotencyKey: 'order' }), { code: 'UNSAFE_APPROVAL_URL', uncertain: true });
});

test('A callback without real PayPal approval never authorizes an order', async () => {
  const { provider, calls } = paypalMock(() => json({ id: 'ORDER1', intent: 'AUTHORIZE', status: 'CREATED' }));
  await assert.rejects(provider.authorizeOrder('ORDER1', 'authorization-op'), { code: 'ORDER_NOT_APPROVED', uncertain: false });
  assert.equal(calls.filter(call => call.url.endsWith('/authorize')).length, 0);
});

test('An approved AUTHORIZE order produces its real authorization, not a capture', async () => {
  const { provider, calls } = paypalMock(call => {
    if (!call.url.endsWith('/authorize')) return json({ id: 'ORDER1', intent: 'AUTHORIZE', status: 'APPROVED', purchase_units: [{ amount: money }] });
    assert.equal(new Headers(call.init.headers).get('paypal-request-id'), paypalRequestId('authorization-op'));
    return json({ id: 'ORDER1', intent: 'AUTHORIZE', status: 'COMPLETED', purchase_units: [
      { amount: money, payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED', amount: money }] } },
    ] }, 201);
  });
  const result = await provider.authorizeOrder('ORDER1', 'authorization-op');
  assert.equal(result.providerId, 'AUTH1');
  assert.equal(result.orderId, 'ORDER1');
  assert.equal(result.status, 'AUTHORIZED');
  assert.equal(calls.filter(call => call.url.includes('/capture')).length, 0);
});

test('An authorized completed order is never mistaken for a completed charge', async () => {
  const { provider } = paypalMock(() => json({ id: 'ORDER1', intent: 'AUTHORIZE', status: 'COMPLETED', purchase_units: [
    { amount: money, payments: { authorizations: [{ id: 'AUTH1', status: 'CREATED', amount: money }] } },
  ] }));
  const result = await provider.getOrder('ORDER1');
  assert.equal(result.status, 'AUTHORIZED');
  assert.equal(result.authorizationId, 'AUTH1');
  assert.equal(result.captureId, undefined);
});

test('Capture uses only the authorization Payments API and exact final amount', async () => {
  const { provider } = paypalMock(call => {
    assert.ok(call.url.endsWith('/v2/payments/authorizations/AUTH1/capture'));
    assert.deepEqual(call.body, { amount: money, final_capture: true });
    return json({ id: 'CAPTURE1', status: 'PENDING', amount: money }, 201);
  });
  const result = await provider.captureAuthorization('AUTH1', 18_000, 'PLN', 'saved-capture-key');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.captureId, 'CAPTURE1');
});

test('A capture timeout remains unknown and is never automatically retried', async () => {
  const { provider, calls } = paypalMock(() => { throw new Error('connection lost after remote acceptance'); });
  await assert.rejects(provider.captureAuthorization('AUTH1', 18_000, 'PLN', 'saved-capture-key'),
    (error: unknown) => error instanceof PayPalProviderError && error.uncertain && error.code === 'PAYPAL_RESULT_UNKNOWN');
  assert.equal(calls.filter(call => call.url.endsWith('/capture')).length, 1);
});

test('A completed provider response with a different or missing amount never confirms a charge', async () => {
  for (const returnedMoney of [{ value: '181.00', currency_code: 'PLN' }, { value: '180.00', currency_code: 'USD' }, undefined]) {
    const { provider } = paypalMock(() => json({ id: 'CAPTURE1', status: 'COMPLETED', amount: returnedMoney }));
    await assert.rejects(provider.captureAuthorization('AUTH1', 18_000, 'PLN', 'saved-capture-key'),
      (error: unknown) => error instanceof PayPalProviderError && error.uncertain && /AMOUNT/.test(error.code));
  }
});

test('An authorization CAPTURED status is not proof of a completed capture', async () => {
  const { provider } = paypalMock(() => json({ id: 'AUTH1', status: 'CAPTURED', amount: money }));
  const result = await provider.getAuthorization('AUTH1');
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.rawStatus, 'CAPTURED');
});

test('A remote conflict/already captured result requires reconciliation', async () => {
  const { provider } = paypalMock(() => json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'AUTHORIZATION_ALREADY_CAPTURED' }] }, 422));
  await assert.rejects(provider.captureAuthorization('AUTH1', 18_000, 'PLN', 'saved-capture-key'), { uncertain: true });
});

test('Void is confirmed by HTTP 204; refund PENDING stays pending until a real read confirms COMPLETED', async () => {
  const { provider } = paypalMock(call => {
    if (call.url.endsWith('/void')) return new Response(null, { status: 204 });
    if (call.url.endsWith('/refund')) return json({ id: 'REFUND1', status: 'PENDING', amount: money }, 201);
    return json({ id: 'REFUND1', status: 'COMPLETED', amount: money });
  });
  const voided = await provider.voidAuthorization('AUTH1', 'void-key');
  assert.equal(voided.status, 'VOIDED');
  assert.equal(voided.raw, undefined);
  assert.equal((await provider.refundCapture('CAPTURE1', 18_000, 'PLN', 'refund-key')).status, 'PENDING');
  assert.equal((await provider.getRefund('REFUND1')).status, 'COMPLETED');
});

test('Webhook must pass the sandbox verification service with all original signature fields', async () => {
  let verificationStatus = 'FAILURE';
  const event = { id: 'EVENT1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE1' } };
  const headers = { 'PAYPAL-AUTH-ALGO': 'SHA256withRSA', 'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST',
    'PAYPAL-TRANSMISSION-ID': 'transmission-1', 'PAYPAL-TRANSMISSION-SIG': 'signature-1', 'PAYPAL-TRANSMISSION-TIME': '2026-10-30T12:00:00Z' };
  const { provider, calls } = paypalMock(call => {
    assert.ok(call.url.endsWith('/v1/notifications/verify-webhook-signature'));
    assert.deepEqual(call.body.webhook_event, event);
    assert.equal(call.body.webhook_id, 'WH-TEST');
    assert.equal(call.body.transmission_id, 'transmission-1');
    return json({ verification_status: verificationStatus });
  });
  assert.equal(await provider.verifyWebhook({}, event), false);
  assert.equal(calls.length, 0);
  assert.equal(await provider.verifyWebhook(headers, event), false);
  verificationStatus = 'SUCCESS';
  assert.equal(await provider.verifyWebhook(headers, event), true);
});

test('Nebius missing key is explicitly unavailable and never yields a local AI success', async () => {
  const provider = new NebiusAiProvider();
  await assert.rejects(provider.parsePreferences('Wybieram pierwszy przedmiot', catalog), { code: 'AI_NOT_CONFIGURED', httpStatus: 503 });
});

test('Nebius schema constrains IDs to the confirmed catalog and records the actual response model', async () => {
  let request: any;
  const provider = new NebiusAiProvider({ apiKey: 'test-key', textModel: 'requested-model', fetch: (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return aiResponse(preferences);
  }) as typeof fetch });
  const result = await provider.parsePreferences('Pierwszy, ewentualnie drugi. Limit 200 zł.', catalog);
  assert.deepEqual(request.response_format.json_schema.schema.properties.preferredIds.items.enum, ['01', '02']);
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(result.maxTotalCents, 20_000);
  assert.equal(result.requiresHumanConfirmation, true);
  assert.equal(result.trace.provider, 'nebius');
  assert.equal(result.trace.mode, 'live');
  assert.equal(result.trace.requestedModel, 'requested-model');
  assert.equal(result.trace.model, 'actual-provider-model');
  assert.equal(result.trace.responseId, 'chatcmpl-provider-response');
  assert.equal(result.trace.usage?.totalTokens, 120);
});

test('AI output cannot add unknown, duplicate, contradictory, or silently invented alternatives', async () => {
  for (const output of [
    { ...preferences, preferredIds: ['not-in-catalog'] },
    { ...preferences, preferredIds: ['01', '01'] },
    { ...preferences, alternativeIds: ['01'] },
    { ...preferences, noAlternativesExplicit: true },
    { ...preferences, priceCents: 500_000 },
  ]) {
    const provider = new NebiusAiProvider({ apiKey: 'test-key', fetch: (async () => aiResponse(output)) as typeof fetch });
    await assert.rejects(provider.parsePreferences('Chcę pierwszy', catalog), { code: 'AI_INVALID_OUTPUT' });
  }
});

test('AI service errors and truncated JSON never become an accepted proposal', async () => {
  for (const response of [json({ error: 'no capacity' }, 503), aiResponse(preferences, { finish: 'length' })]) {
    let calls = 0;
    const provider = new NebiusAiProvider({ apiKey: 'test-key', fetch: (async () => { calls++; return response; }) as typeof fetch });
    await assert.rejects(provider.parsePreferences('Chcę pierwszy', catalog), (error: unknown) => error instanceof AiProviderError);
    assert.equal(calls, 1);
  }
});

test('Vision sends the actual uploaded photo and returns unconfirmed, source-bound item proposals', async () => {
  let request: any;
  const provider = new NebiusAiProvider({ apiKey: 'test-key', fetch: (async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return aiResponse({ items: [{ name: 'Przedmiot z fotografii', description: 'Widoczny prostokątny przedmiot', visibleText: null,
      observedCondition: null, uncertain: true, confidence: 0.6, imageRegion: null }], warnings: ['Wymaga obejrzenia'] });
  }) as typeof fetch });
  const result = await provider.extractCatalog(png);
  assert.equal(request.messages[1].content[1].image_url.url, png);
  assert.equal(result.items[0].confirmed, false);
  assert.equal(result.requiresHumanConfirmation, true);
  assert.equal(result.sourceImageSha256, createHash('sha256').update(pngBytes).digest('hex'));
  assert.ok(result.items[0].id.startsWith(`AI-${result.sourceImageSha256.slice(0, 12)}-`));
  assert.equal(Object.hasOwn(result.items[0], 'shareCents'), false);
});

test('Vision rejects external URLs and unsupported uploads before any provider call', async () => {
  let calls = 0;
  const provider = new NebiusAiProvider({ apiKey: 'test-key', fetch: (async () => { calls++; return aiResponse({}); }) as typeof fetch });
  for (const upload of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aW52YWxpZA==']) {
    await assert.rejects(provider.extractCatalog(upload), { code: 'INVALID_IMAGE' });
  }
  assert.equal(calls, 0);
});
