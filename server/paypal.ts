import { createHash } from 'node:crypto';

/** No runtime setting, redirect, or provider response can select PayPal Live. */
export const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';

export type ProviderStatus =
  | 'CREATED' | 'APPROVED' | 'AUTHORIZED' | 'COMPLETED' | 'PENDING'
  | 'VOIDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

export interface PaymentTrace {
  provider: 'paypal';
  environment: 'sandbox';
  endpoint: string;
  requestId?: string;
  debugId?: string;
  httpStatus: number;
  occurredAt: string;
}

export interface ProviderResult {
  providerId: string;
  status: ProviderStatus;
  rawStatus?: string;
  approvalUrl?: string;
  amountCents?: number;
  currency?: string;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
  refundId?: string;
  expiresAt?: string;
  raw?: Record<string, unknown>;
  trace?: PaymentTrace;
}

export interface CreateOrderInput {
  amountCents: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  customId: string;
}

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<ProviderResult>;
  authorizeOrder(orderId: string, idempotencyKey: string): Promise<ProviderResult>;
  captureAuthorization(authorizationId: string, amountCents: number, currency: string, idempotencyKey: string): Promise<ProviderResult>;
  voidAuthorization(authorizationId: string, idempotencyKey: string): Promise<ProviderResult>;
  refundCapture(captureId: string, amountCents: number, currency: string, idempotencyKey: string): Promise<ProviderResult>;
  getOrder(orderId: string): Promise<ProviderResult>;
  getAuthorization(authorizationId: string): Promise<ProviderResult>;
  getCapture(captureId: string): Promise<ProviderResult>;
  getRefund(refundId: string): Promise<ProviderResult>;
  verifyWebhook?(headers: WebhookHeaders, event: unknown): Promise<boolean>;
}

export interface PaypalConfig {
  clientId?: string;
  clientSecret?: string;
  webhookId?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export type PayPalConfig = PaypalConfig;

/** `uncertain` means reconcile the saved operation; never start a replacement charge. */
export class PayPalProviderError extends Error {
  readonly provider = 'paypal';
  readonly environment = 'sandbox';
  constructor(
    readonly code: string,
    message: string,
    readonly uncertain = false,
    readonly httpStatus?: number,
    readonly debugId?: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'PayPalProviderError';
  }
}

type Json = Record<string, unknown>;
type ApiResponse = { body: Json; trace: PaymentTrace };

function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function validId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new PayPalProviderError('INVALID_PROVIDER_ID', 'Invalid PayPal resource identifier.');
  }
  return id;
}
function amount(amountCents: number, currency: string): Json {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100_000_000 || currency !== 'PLN') {
    throw new PayPalProviderError('INVALID_AMOUNT', 'An exact positive PLN amount in cents is required.');
  }
  return { value: (amountCents / 100).toFixed(2), currency_code: currency };
}
function readAmount(value: unknown): { amountCents?: number; currency?: string } {
  const source = object(value);
  if (typeof source.value !== 'string' || !/^\d+\.\d{2}$/.test(source.value)
    || typeof source.currency_code !== 'string' || !/^[A-Z]{3}$/.test(source.currency_code)) return {};
  const [whole, fraction] = source.value.split('.');
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents)) return {};
  return { amountCents: cents, currency: text(source.currency_code) };
}
function requireExpectedAmount(result: ProviderResult, amountCents: number | undefined, currency: string | undefined): ProviderResult {
  if (amountCents === undefined || currency === undefined || result.amountCents !== amountCents || result.currency !== currency) {
    throw new PayPalProviderError('PAYPAL_AMOUNT_MISMATCH', 'PayPal did not confirm the exact expected amount and currency. Reconcile the saved operation.', true);
  }
  return result;
}
function requireExpectedId(result: ProviderResult, expectedId: string): ProviderResult {
  if (result.providerId !== expectedId) throw new PayPalProviderError('PAYPAL_ID_MISMATCH', 'PayPal returned a different resource. Reconcile the saved operation.', true);
  return result;
}
function requirePaymentAmount(status: ProviderStatus, money: { amountCents?: number; currency?: string }): void {
  if (['AUTHORIZED', 'COMPLETED', 'PENDING'].includes(status)
    && (money.amountCents === undefined || money.amountCents <= 0 || money.currency !== 'PLN')) {
    throw new PayPalProviderError('PAYPAL_AMOUNT_UNCONFIRMED', 'PayPal did not confirm a valid PLN payment amount.', true);
  }
}
function callbackUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PayPalProviderError('INVALID_CALLBACK_URL', 'A valid callback URL is required.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new PayPalProviderError('INVALID_CALLBACK_URL', 'Callbacks require HTTPS, or HTTP on localhost.');
  }
  return url.href;
}

/** Fits the most restrictive Payments API key length; stable across process restarts. */
export function paypalRequestId(idempotencyKey: string): string {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 1024) {
    throw new PayPalProviderError('MISSING_IDEMPOTENCY_KEY', 'A previously saved idempotency key is required.');
  }
  return `ls-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32)}`;
}

function resourceStatus(rawStatus: string | undefined, kind: 'authorization' | 'capture' | 'refund'): ProviderStatus {
  if (kind === 'authorization' && rawStatus === 'CREATED') return 'AUTHORIZED';
  if (kind !== 'authorization' && rawStatus === 'COMPLETED') return 'COMPLETED';
  if (rawStatus === 'PENDING') return 'PENDING';
  if (rawStatus === 'VOIDED') return 'VOIDED';
  if (rawStatus === 'CANCELLED') return 'CANCELLED';
  if (['DENIED', 'DECLINED', 'FAILED', 'EXPIRED'].includes(rawStatus ?? '')) return 'FAILED';
  // CAPTURED is an authorization state, not proof of a COMPLETED capture.
  // REFUNDED/PARTIALLY_REFUNDED also must not unlock fulfillment.
  return 'UNKNOWN';
}

function paymentResult(source: Json, kind: 'authorization' | 'capture' | 'refund', trace: PaymentTrace): ProviderResult {
  const providerId = text(source.id);
  if (!providerId) throw new PayPalProviderError('INVALID_PROVIDER_RESPONSE', 'PayPal did not return a payment identifier.', true);
  const rawStatus = text(source.status);
  const ids = object(object(source.supplementary_data).related_ids);
  const status = resourceStatus(rawStatus, kind);
  const money = readAmount(source.amount);
  requirePaymentAmount(status, money);
  return {
    providerId, status, rawStatus,
    ...money, raw: source, trace,
    orderId: text(ids.order_id), authorizationId: text(ids.authorization_id),
    captureId: text(ids.capture_id), expiresAt: text(source.expiration_time),
    ...(kind === 'authorization' ? { authorizationId: providerId } : {}),
    ...(kind === 'capture' ? { captureId: providerId } : {}),
    ...(kind === 'refund' ? { refundId: providerId } : {}),
  };
}

function orderPayments(source: Json): { authorization: Json; capture: Json; unit: Json } {
  const units = array(source.purchase_units).map(object);
  // LOTSPLIT deliberately creates one purchase unit, never a multi-merchant order.
  if (units.length > 1) throw new PayPalProviderError('UNEXPECTED_PURCHASE_UNITS', 'Unexpected PayPal purchase units.', true);
  const unit = units[0] ?? {};
  const payments = object(unit.payments);
  const authorizations = array(payments.authorizations).map(object);
  const captures = array(payments.captures).map(object);
  if (authorizations.length > 1 || captures.length > 1) {
    throw new PayPalProviderError('UNEXPECTED_PAYMENT_COUNT', 'PayPal returned multiple payments for one buyer.', true);
  }
  return { unit, authorization: authorizations[0] ?? {}, capture: captures[0] ?? {} };
}

function orderResult(source: Json, trace: PaymentTrace): ProviderResult {
  const providerId = text(source.id);
  if (!providerId) throw new PayPalProviderError('INVALID_PROVIDER_RESPONSE', 'PayPal did not return an order identifier.', true);
  const { authorization, capture, unit } = orderPayments(source);
  const rawStatus = text(source.status);
  let status: ProviderStatus = rawStatus === 'APPROVED' ? 'APPROVED'
    : ['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED'].includes(rawStatus ?? '') ? 'CREATED'
      : rawStatus === 'VOIDED' ? 'VOIDED' : 'UNKNOWN';
  if (text(authorization.id)) status = resourceStatus(text(authorization.status), 'authorization');
  if (text(capture.id)) status = resourceStatus(text(capture.status), 'capture');
  const money = readAmount(unit.amount);
  requirePaymentAmount(status, money);
  for (const child of [authorization, capture]) {
    if (text(child.id)) {
      const childMoney = readAmount(child.amount);
      if (childMoney.amountCents !== money.amountCents || childMoney.currency !== money.currency) {
        throw new PayPalProviderError('PAYPAL_AMOUNT_MISMATCH', 'PayPal order and payment amounts do not match.', true);
      }
    }
  }
  let approvalUrl: string | undefined;
  const link = array(source.links).map(object).find(link => ['approve', 'payer-action'].includes(String(link.rel)));
  if (link && typeof link.href === 'string') {
    let url: URL;
    try { url = new URL(link.href); } catch { throw new PayPalProviderError('UNSAFE_APPROVAL_URL', 'PayPal returned an invalid approval URL.', true); }
    if (url.protocol !== 'https:' || url.hostname !== 'www.sandbox.paypal.com' || url.port || url.username || url.password) {
      throw new PayPalProviderError('UNSAFE_APPROVAL_URL', 'PayPal approval must remain in the sandbox.', true);
    }
    approvalUrl = url.href;
  }
  return {
    providerId, orderId: providerId, status, rawStatus, approvalUrl,
    authorizationId: text(authorization.id), captureId: text(capture.id),
    expiresAt: text(authorization.expiration_time), ...money, raw: source, trace,
  };
}

export class PayPalSandboxProvider implements PaymentProvider {
  readonly provider = 'paypal';
  readonly environment = 'sandbox';
  readonly baseUrl = PAYPAL_SANDBOX_BASE_URL;
  private readonly config: PaypalConfig;
  private readonly fetcher: typeof globalThis.fetch;
  private token?: { value: string; expiresAt: number };
  private tokenInFlight?: Promise<string>;

  constructor(config: PaypalConfig = {}) {
    const candidate = config.baseUrl ?? PAYPAL_SANDBOX_BASE_URL;
    let url: URL;
    try { url = new URL(candidate); } catch { throw new PayPalProviderError('SANDBOX_REQUIRED', 'Only the PayPal sandbox endpoint is permitted.'); }
    if (url.origin !== PAYPAL_SANDBOX_BASE_URL || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new PayPalProviderError('SANDBOX_REQUIRED', 'Only https://api-m.sandbox.paypal.com is permitted.');
    }
    this.config = { ...config };
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  get configured(): boolean { return Boolean(this.config.clientId?.trim() && this.config.clientSecret?.trim()); }
  get configuration() {
    return { provider: this.provider, environment: this.environment, configured: this.configured,
      webhookConfigured: Boolean(this.config.webhookId?.trim()), baseUrl: this.baseUrl };
  }

  private async accessToken(): Promise<string> {
    if (!this.configured) throw new PayPalProviderError('PAYPAL_NOT_CONFIGURED', 'PayPal sandbox credentials are not configured.', false, 503);
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    if (this.tokenInFlight) return this.tokenInFlight;
    const request = this.loadToken();
    this.tokenInFlight = request;
    try { return await request; } finally { this.tokenInFlight = undefined; }
  }

  private async loadToken(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetcher(`${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'grant_type=client_credentials', signal: AbortSignal.timeout(this.config.timeoutMs ?? 25_000),
      });
    } catch {
      throw new PayPalProviderError('PAYPAL_AUTH_UNAVAILABLE', 'PayPal sandbox authentication is unavailable.', false, 503);
    }
    let body: Json;
    try { body = object(await response.json()); } catch { throw new PayPalProviderError('PAYPAL_AUTH_INVALID', 'PayPal sandbox returned an invalid authentication response.', false, 503); }
    const value = text(body.access_token);
    if (!response.ok || !value) throw new PayPalProviderError('PAYPAL_AUTH_FAILED', 'PayPal sandbox authentication failed.', false, response.status);
    const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 60;
    this.token = { value, expiresAt: Date.now() + ttl * 1000 };
    return value;
  }

  private async request(path: string, options: { method?: 'GET' | 'POST'; body?: Json; idempotencyKey?: string } = {}): Promise<ApiResponse> {
    const token = await this.accessToken();
    const method = options.method ?? 'GET';
    const requestId = options.idempotencyKey === undefined ? undefined : paypalRequestId(options.idempotencyKey);
    let response: Response;
    try {
      response = await this.fetcher(`${PAYPAL_SANDBOX_BASE_URL}${path}`, {
        method, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json',
          Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
        body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 25_000),
      });
    } catch {
      // There is intentionally no automatic financial retry here.
      throw new PayPalProviderError('PAYPAL_RESULT_UNKNOWN', 'The PayPal result is unknown. Reconcile the existing operation.', true, 503);
    }
    const trace: PaymentTrace = { provider: 'paypal', environment: 'sandbox', endpoint: path, requestId,
      debugId: response.headers.get('paypal-debug-id') ?? undefined, httpStatus: response.status, occurredAt: new Date().toISOString() };
    let body: Json = {};
    if (response.status !== 204) {
      try { body = object(await response.json()); } catch {
        throw new PayPalProviderError('PAYPAL_INVALID_RESPONSE', 'PayPal returned an unreadable response. Reconcile the existing operation.', method === 'POST', response.status, trace.debugId);
      }
    }
    if (!response.ok) {
      if (response.status === 401) this.token = undefined;
      const issues = array(body.details).map(object).map(detail => text(detail.issue)).filter((issue): issue is string => Boolean(issue));
      const alreadyProcessed = issues.some(issue => /ALREADY|PREVIOUS_REQUEST|DUPLICATE|CONFLICT/.test(issue));
      const uncertain = response.status >= 500 || [408, 409].includes(response.status) || alreadyProcessed;
      const code = text(body.name)?.replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'PAYPAL_REQUEST_FAILED';
      throw new PayPalProviderError(code, `PayPal sandbox returned HTTP ${response.status}.`, uncertain, response.status, trace.debugId, issues);
    }
    return { body, trace };
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderResult> {
    const money = amount(input.amountCents, input.currency);
    paypalRequestId(input.idempotencyKey);
    if (!input.customId || input.customId.length > 127 || !input.description || input.description.length > 127) {
      throw new PayPalProviderError('INVALID_ORDER_METADATA', 'Order description and saved operation reference are required.');
    }
    const result = await this.request('/v2/checkout/orders', {
      method: 'POST', idempotencyKey: input.idempotencyKey,
      body: {
        intent: 'AUTHORIZE',
        purchase_units: [{ reference_id: 'LOTSPLIT', custom_id: input.customId, description: input.description, amount: money }],
        payment_source: { paypal: { experience_context: { brand_name: 'LOTSPLIT Sandbox', user_action: 'CONTINUE',
          shipping_preference: 'NO_SHIPPING', return_url: callbackUrl(input.returnUrl), cancel_url: callbackUrl(input.cancelUrl) } } },
      },
    });
    const order = orderResult(result.body, result.trace);
    if (order.status === 'CREATED' && !order.approvalUrl) {
      throw new PayPalProviderError('MISSING_APPROVAL_URL', 'PayPal did not return a buyer approval URL. Reconcile the saved order.', true);
    }
    return requireExpectedAmount(order, input.amountCents, input.currency);
  }

  async authorizeOrder(orderId: string, idempotencyKey: string): Promise<ProviderResult> {
    validId(orderId); paypalRequestId(idempotencyKey);
    // A callback token or PayerID by itself is never evidence of approval.
    const current = await this.getOrder(orderId);
    if (current.raw?.intent !== 'AUTHORIZE') throw new PayPalProviderError('WRONG_ORDER_INTENT', 'The PayPal order must use AUTHORIZE intent.');
    if (current.authorizationId) return requireExpectedAmount({ ...await this.getAuthorization(current.authorizationId), orderId }, current.amountCents, current.currency);
    if (current.rawStatus !== 'APPROVED') throw new PayPalProviderError('ORDER_NOT_APPROVED', 'The buyer has not approved this order in PayPal sandbox.');
    const result = await this.request(`/v2/checkout/orders/${orderId}/authorize`, { method: 'POST', body: {}, idempotencyKey });
    const { authorization } = orderPayments(result.body);
    return requireExpectedAmount({ ...paymentResult(authorization, 'authorization', result.trace), orderId }, current.amountCents, current.currency);
  }

  async captureAuthorization(authorizationId: string, amountCents: number, currency: string, idempotencyKey: string): Promise<ProviderResult> {
    validId(authorizationId); paypalRequestId(idempotencyKey);
    const result = await this.request(`/v2/payments/authorizations/${authorizationId}/capture`, {
      method: 'POST', idempotencyKey, body: { amount: amount(amountCents, currency), final_capture: true },
    });
    return requireExpectedAmount({ ...paymentResult(result.body, 'capture', result.trace), authorizationId }, amountCents, currency);
  }

  async voidAuthorization(authorizationId: string, idempotencyKey: string): Promise<ProviderResult> {
    validId(authorizationId); paypalRequestId(idempotencyKey);
    const result = await this.request(`/v2/payments/authorizations/${authorizationId}/void`, { method: 'POST', idempotencyKey });
    // Payments v2 confirms a successful void with HTTP 204 and no JSON body.
    if (result.trace.httpStatus === 204) return { providerId: authorizationId, authorizationId, status: 'VOIDED', trace: result.trace };
    return paymentResult(result.body, 'authorization', result.trace);
  }

  async refundCapture(captureId: string, amountCents: number, currency: string, idempotencyKey: string): Promise<ProviderResult> {
    validId(captureId); paypalRequestId(idempotencyKey);
    const result = await this.request(`/v2/payments/captures/${captureId}/refund`, {
      method: 'POST', idempotencyKey, body: { amount: amount(amountCents, currency) },
    });
    return requireExpectedAmount({ ...paymentResult(result.body, 'refund', result.trace), captureId }, amountCents, currency);
  }

  async getOrder(orderId: string): Promise<ProviderResult> {
    const result = await this.request(`/v2/checkout/orders/${validId(orderId)}`);
    return requireExpectedId(orderResult(result.body, result.trace), orderId);
  }
  async getAuthorization(authorizationId: string): Promise<ProviderResult> {
    const result = await this.request(`/v2/payments/authorizations/${validId(authorizationId)}`);
    return requireExpectedId(paymentResult(result.body, 'authorization', result.trace), authorizationId);
  }
  async getCapture(captureId: string): Promise<ProviderResult> {
    const result = await this.request(`/v2/payments/captures/${validId(captureId)}`);
    return requireExpectedId(paymentResult(result.body, 'capture', result.trace), captureId);
  }
  async getRefund(refundId: string): Promise<ProviderResult> {
    const result = await this.request(`/v2/payments/refunds/${validId(refundId)}`);
    return requireExpectedId(paymentResult(result.body, 'refund', result.trace), refundId);
  }

  async verifyWebhook(headers: WebhookHeaders, event: unknown): Promise<boolean> {
    if (!this.config.webhookId) throw new PayPalProviderError('PAYPAL_WEBHOOK_NOT_CONFIGURED', 'A PayPal sandbox webhook ID is required.', false, 503);
    const normalized = new Headers();
    if (headers instanceof Headers) headers.forEach((value, key) => normalized.set(key, value));
    else for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') normalized.set(key, value);
      else if (value?.length === 1) normalized.set(key, value[0]);
    }
    const fields: Record<string, string> = {};
    for (const [field, header] of Object.entries({ auth_algo: 'paypal-auth-algo', cert_url: 'paypal-cert-url',
      transmission_id: 'paypal-transmission-id', transmission_sig: 'paypal-transmission-sig', transmission_time: 'paypal-transmission-time' })) {
      const value = normalized.get(header);
      if (!value || value.length > 1000) return false;
      fields[field] = value;
    }
    const body = object(event);
    if (!text(body.id) || !text(body.event_type) || !body.resource) return false;
    // We never download a certificate supplied by the caller. PayPal verifies it.
    let cert: URL;
    try { cert = new URL(fields.cert_url); } catch { return false; }
    if (cert.protocol !== 'https:' || !['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(cert.hostname)
      || !cert.pathname.startsWith('/v1/notifications/certs/') || cert.username || cert.password || cert.port) return false;
    const result = await this.request('/v1/notifications/verify-webhook-signature', {
      method: 'POST', body: { ...fields, webhook_id: this.config.webhookId, webhook_event: body },
    });
    return result.body.verification_status === 'SUCCESS';
  }
}

export function createPayPalProvider(env: Record<string, string | undefined> = process.env): PayPalSandboxProvider {
  for (const setting of [env.PAYPAL_ENVIRONMENT, env.PAYPAL_MODE]) {
    if (setting && setting.toLowerCase() !== 'sandbox') throw new PayPalProviderError('SANDBOX_REQUIRED', 'PayPal Live is disabled for LOTSPLIT.');
  }
  return new PayPalSandboxProvider({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET,
    webhookId: env.PAYPAL_WEBHOOK_ID, baseUrl: env.PAYPAL_BASE_URL });
}
