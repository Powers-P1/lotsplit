import { Router, type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { AiProvider } from './ai.js';
import { DomainError, LotSplitEngine } from './domain.js';
import type { BuyerId, RehearsalScenario, UserId } from '../shared/types.js';
import { getDemoDefaults, userForId } from './seed.js';

export interface ApiRouterOptions { aiProvider?: AiProvider; origin?: string; organizerAccessToken?: string }
const COOKIE = 'lotsplit_session';
const BUYERS: BuyerId[] = ['maja', 'ola', 'bartek', 'jan', 'ewa'];
const asyncRoute = (handler: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve().then(() => handler(req, res)).catch(next); };
function body(req: Request): Record<string, unknown> { return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {}; }
function requiredString(value: unknown, field: string, maximum = 6000): string { if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new DomainError('INVALID_FIELD', 'Complete the required field.', 400, { [field]: 'Check this field.' }); return value; }
function buyerId(value: unknown): BuyerId { if (!BUYERS.includes(value as BuyerId)) throw new DomainError('INVALID_BUYER', 'Participant not found.', 404); return value as BuyerId; }
function cookieToken(req: Request): string | undefined {
  const value = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : undefined;
}
function equalSecret(actual: string, expected: string) { return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); }

/** Mount at /api. All roles and financial terms come from the server-side session. */
export function createApiRouter(engine: LotSplitEngine, options: ApiRouterOptions = {}) {
  const router = Router(); const origin = options.origin ? new URL(options.origin).origin : undefined;
  const session = (req: Request): UserId | undefined => engine.store.sessionUser(cookieToken(req));
  const authenticated = (req: Request): UserId => { const id = session(req); if (!id) throw new DomainError('UNAUTHENTICATED', 'Use your invitation to access your collection.', 401); return id; };
  const organizer = (req: Request) => { const id = authenticated(req); if (id !== 'kasia') throw new DomainError('FORBIDDEN', 'This action is available to the organizer.', 403); return id; };
  const result = (req: Request, res: Response, extra: object = {}) => res.json({ state: engine.view(session(req)), ...extra });
  const setSession = (res: Response, id: UserId) => res.cookie(COOKIE, engine.store.createSession(id), { httpOnly: true,
    sameSite: 'lax', secure: origin?.startsWith('https:') ?? false, path: '/', maxAge: 7 * 86400000 });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/payments/webhook') {
      const supplied = req.headers.origin;
      const expected = origin ?? `${req.protocol}://${req.get('host')}`;
      if (supplied && supplied !== expected) return next(new DomainError('ORIGIN_REJECTED', 'Open LOTSPLIT to perform this action.', 403));
      if (req.headers['sec-fetch-site'] === 'cross-site') return next(new DomainError('ORIGIN_REJECTED', 'Open LOTSPLIT to perform this action.', 403));
      if (body(req).revision !== undefined) engine.checkRevision(body(req).revision);
    }
    next();
  });
  router.get('/state', (req, res) => res.json(engine.view(session(req))));
  router.get('/session', (req, res) => res.json(engine.view(session(req))));
  router.post('/auth/demo', asyncRoute((req, res) => {
    if (engine.options.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Demo sign-in is disabled in sandbox mode.', 403);
    const input = body(req);
    const id = engine.invitationUser(requiredString(input.inviteToken, 'inviteToken'));
    if (!id) throw new DomainError('INVALID_INVITATION', 'The invitation is invalid or has expired.', 401);
    if (input.collectionId !== undefined) engine.setRehearsalCollection(id, input.collectionId);
    setSession(res, id); res.json({ state: engine.view(id) });
  }));
  router.post('/auth/request-link', asyncRoute((req, res) => {
    const input = body(req); const email = requiredString(input.email, 'email').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError('INVALID_EMAIL', 'Enter a valid email address.', 400, { email: 'Invalid email address.' });
    const invitation = typeof input.inviteToken === 'string' ? input.inviteToken : '';
    let id = engine.invitationUser(invitation);
    if (!id && engine.options.mode === 'sandbox' && options.organizerAccessToken && equalSecret(invitation, options.organizerAccessToken)) id = 'kasia';
    if (!id && engine.options.mode === 'rehearsal') id = (['kasia', ...BUYERS] as UserId[]).find(userId => userForId(userId).email === email);
    if (!id || userForId(id).email !== email) throw new DomainError('INVALID_INVITATION', 'The email does not match the invitation, or the link has expired.', 401);
    const token = engine.store.createLoginLink(id);
    // Local review delivery is explicit. No mail is sent by this MVP.
    result(req, res, { link: `/api/auth/consume?token=${encodeURIComponent(token)}`,
      message: 'Your sign-in link is ready in this session. This version of the app does not send emails.' });
  }));
  router.get('/auth/consume', asyncRoute((req, res) => {
    const id = engine.store.consumeLoginLink(requiredString(req.query.token, 'token'));
    if (!id) throw new DomainError('EXPIRED_LINK', 'This link is invalid, already used, or expired.', 401);
    setSession(res, id); res.redirect('/');
  }));
  router.post('/auth/logout', (req, res) => { engine.store.deleteSession(cookieToken(req)); res.clearCookie(COOKIE, { path: '/' }); res.json({ state: engine.view() }); });

  router.patch('/collection', asyncRoute(async (req, res) => { engine.updateCollection(organizer(req), body(req)); await engine.processPendingCompensation(); result(req, res); }));
  router.patch('/items/:id', asyncRoute(async (req, res) => { engine.updateItem(organizer(req), String(req.params.id), body(req)); await engine.processPendingCompensation(); result(req, res); }));
  router.post('/catalog/confirm', asyncRoute((req, res) => { engine.confirmCatalog(organizer(req)); result(req, res); }));
  router.post('/invitations', asyncRoute((req, res) => { const link = engine.invite(organizer(req), buyerId(body(req).buyerId)); result(req, res, { link }); }));
  router.put('/preferences', asyncRoute(async (req, res) => { engine.savePreferences(authenticated(req), body(req)); await engine.processPendingCompensation(); result(req, res); }));
  router.put('/preferences/alternatives', asyncRoute(async (req, res) => { engine.saveAlternatives(authenticated(req), body(req)); await engine.processPendingCompensation(); result(req, res); }));
  router.post('/plan/solve', asyncRoute(async (req, res) => { engine.solve(organizer(req)); await engine.processPendingCompensation(); result(req, res); }));
  router.post('/plan/send', asyncRoute((req, res) => { engine.sendPlan(organizer(req), requiredString(body(req).planId, 'planId')); result(req, res); }));
  router.post('/plan/agree', asyncRoute((req, res) => { engine.agree(authenticated(req), requiredString(body(req).planId, 'planId'), requiredString(body(req).termsDigest, 'termsDigest')); result(req, res); }));
  router.post('/participants/withdraw', asyncRoute(async (req, res) => { await engine.withdraw(authenticated(req)); result(req, res); }));
  router.post('/participants/replace', asyncRoute(async (req, res) => {
    const input = body(req); await engine.replace(organizer(req), buyerId(input.leavingBuyerId), buyerId(input.replacementBuyerId)); result(req, res);
  }));
  router.put('/address', asyncRoute((req, res) => { engine.saveAddress(authenticated(req), body(req)); result(req, res); }));
  router.post('/payments/authorize', asyncRoute(async (req, res) => { const extra = await engine.authorize(authenticated(req), requiredString(body(req).planId, 'planId')); result(req, res, extra); }));
  router.post('/payments/approve', asyncRoute(async (req, res) => {
    const outcome = body(req).outcome; if (outcome !== undefined && !['approve', 'decline'].includes(outcome as string)) throw new DomainError('INVALID_OUTCOME', 'Invalid authorization outcome.');
    const extra = await engine.approve(authenticated(req), requiredString(body(req).operationId, 'operationId'), outcome as 'approve' | 'decline' | undefined); result(req, res, extra);
  }));
  router.post('/payments/cancel', asyncRoute((req, res) => { engine.cancelPayment(authenticated(req), requiredString(body(req).operationId, 'operationId')); result(req, res); }));
  router.post('/payments/capture', asyncRoute(async (req, res) => { await engine.capture(organizer(req), requiredString(body(req).planId, 'planId')); result(req, res); }));
  router.post('/payments/reconcile', asyncRoute(async (req, res) => {
    const id = authenticated(req); const operationId = body(req).operationId;
    if (operationId !== undefined && typeof operationId !== 'string') throw new DomainError('INVALID_OPERATION', 'Invalid operation.');
    if (id !== 'kasia' && !operationId) throw new DomainError('OPERATION_REQUIRED', 'Choose one of your own operations.');
    await engine.reconcile(id, operationId as string | undefined); result(req, res);
  }));
  router.post('/payments/retry-compensation', asyncRoute(async (req, res) => {
    const extra = await engine.retryCompensation(organizer(req), requiredString(body(req).operationId, 'operationId')); result(req, res, extra);
  }));
  router.post('/payments/webhook', asyncRoute(async (req, res) => {
    const provider = engine.options.paymentProvider;
    if (engine.options.mode !== 'sandbox' || !provider?.verifyWebhook || !await provider.verifyWebhook(req.headers, req.body)) throw new DomainError('WEBHOOK_SIGNATURE', 'Invalid event signature.', 401);
    await engine.verifiedWebhook(req.body); res.json({ received: true });
  }));
  router.put('/packing/:buyerId', asyncRoute((req, res) => { engine.updatePacking(organizer(req), buyerId(req.params.buyerId), body(req)); result(req, res); }));
  router.post('/rehearsal/scenario', asyncRoute(async (req, res) => { await engine.setScenario(organizer(req), requiredString(body(req).scenario, 'scenario') as RehearsalScenario); result(req, res); }));
  router.post('/rehearsal/collection', asyncRoute((req, res) => { engine.setRehearsalCollection(organizer(req), body(req).collectionId); result(req, res); }));
  router.post('/rehearsal/outcome', asyncRoute((req, res) => { engine.setRehearsalOutcome(organizer(req), body(req).outcome); result(req, res); }));

  router.post('/ai/catalog', asyncRoute(async (req, res) => {
    organizer(req); const state = engine.snapshot();
    if (state.collection.preferencesOpened) throw new DomainError('CATALOG_LOCKED', 'The catalog is already confirmed. Make corrections to individual items.', 409);
    if (engine.options.mode === 'rehearsal' && !options.aiProvider) return result(req, res, { source: 'rehearsal', proposal: {
      items: state.collection.items.map(i => ({ id: i.id, name: i.name, description: i.description, observedCondition: i.condition,
        uncertain: false, confidence: 1, confirmed: false, imageRegion: null })),
      requiresHumanConfirmation: true, warnings: ['Example demo catalog. This image has not been read by AI.'] } });
    if (!options.aiProvider) throw new DomainError('AI_NOT_CONFIGURED', 'AI catalog extraction is not configured. You can review the catalog manually.', 503);
    const proposal = await options.aiProvider.extractCatalog(requiredString(body(req).imageDataUrl, 'imageDataUrl', 12000000));
    result(req, res, { source: 'nebius', proposal });
  }));
  router.post('/ai/preferences', asyncRoute(async (req, res) => {
    const id = authenticated(req); if (id === 'kasia') throw new DomainError('FORBIDDEN', 'The buyer must review the preference proposal.', 403);
    const state = engine.snapshot(); if (state.collection.catalogStatus !== 'confirmed') throw new DomainError('CATALOG_REQUIRED', 'A confirmed catalog is required first.', 409);
    if (engine.options.mode === 'rehearsal' && !options.aiProvider) {
      const demo = getDemoDefaults(state.rehearsalCollectionId, id); return result(req, res, { source: 'rehearsal', proposal: { preferredIds: demo.preferredItemIds,
        alternativeIds: demo.alternativeItemIds, rejectedIds: [], maxTotalCents: demo.budgetCents, noAlternativesExplicit: !demo.alternativeItemIds.length,
        ambiguities: ['Example demo preferences. Your description has not been processed by AI.'], requiresHumanConfirmation: true } });
    }
    if (!options.aiProvider) throw new DomainError('AI_NOT_CONFIGURED', 'AI assistance is not configured. Choose items manually.', 503);
    const proposal = await options.aiProvider.parsePreferences(requiredString(body(req).text, 'text'), state.collection.items);
    result(req, res, { source: 'nebius', proposal });
  }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof DomainError) { res.status(error.httpStatus).json({ error: error.message, code: error.code, fields: error.fields }); return; }
    const provider = error as { provider?: string; code?: string; httpStatus?: number };
    if (provider.provider === 'nebius') { res.status(provider.httpStatus && provider.httpStatus < 600 ? provider.httpStatus : 503).json({ error: 'AI did not return a valid proposal. No data was confirmed; try again or enter it manually.', code: provider.code ?? 'AI_UNAVAILABLE' }); return; }
    console.error('[LOTSPLIT] Unhandled API error:', error instanceof Error ? error.name : 'Unknown error');
    res.status(500).json({ error: 'This action could not be saved. Refresh the page and check the current state.', code: 'INTERNAL_ERROR' });
  };
  router.use(errors);
  return router;
}
