import { createHash, randomUUID } from 'node:crypto';
import type {
  AllocationPlan, AppMode, AppView, Assignment, BuyerId, BuyerPayment, Collection, CollectionItem,
  Consent, DeliveryAddress, Gates, NoSolution, OperationKind, OperationStatus, PackingPackage,
  Participant, PaymentOperation, PaymentView, Preferences, RehearsalScenario, UserId,
} from '../shared/types.js';
import { createCollection, createParticipants, DEMO_ACCESS, getDemoDefaults, sourceForMode, userForId } from './seed.js';
import { DEFAULT_DEMO_COLLECTION_ID, isDemoCollectionId, type DemoCollectionId } from '../shared/demo-collections.js';
import { PayPalProviderError, type CreateOrderInput, type PaymentProvider, type ProviderResult } from './paypal.js';
import { SqliteStore } from './store.js';

export class DomainError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400, public fields?: Record<string, string>) { super(message); }
}
type FrozenPaymentCommand =
  | { kind: 'order'; input: CreateOrderInput }
  | { kind: 'authorize' | 'void'; providerId: string; idempotencyKey: string }
  | { kind: 'capture' | 'refund'; providerId: string; amountCents: number; currency: string; idempotencyKey: string };
interface SavedPaymentCommand {
  command: FrozenPaymentCommand;
  attempts: number;
  leaseToken?: string;
  leaseExpiresAt?: string;
}
// PayPal documents Orders keys for 6h and Payments capture/void/refund keys for 45 days:
// https://developer.paypal.com/sdk/orders/v2/orders-create/
// https://github.com/paypal/PayPal-PHP-Server-SDK/blob/main/doc/controllers/payments.md
// Five hours is our conservative common policy, not a claim of unlimited provider retention.
// Age is always measured from the original persisted operation, never a retry or server restart.
const SAFE_REPLAY_WINDOW_MS = 5 * 60 * 60 * 1000;
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
export interface DomainState {
  schemaVersion: 1;
  revision: number;
  mode: AppMode;
  rehearsalCollectionId?: DemoCollectionId;
  collection: Collection;
  participants: Participant[];
  plans: AllocationPlan[];
  currentPlanId?: string;
  noSolution?: NoSolution;
  operations: Record<string, PaymentOperation>;
  paymentCommands?: Record<string, SavedPaymentCommand>;
  packing: PackingPackage[];
  webhookEventIds: string[];
  invitationTokens: Partial<Record<UserId, string>>;
  rehearsalCaptureOutcome: 'success' | 'unknown-ola' | 'failure-ola';
}
export interface EngineOptions {
  mode: AppMode;
  paymentProvider?: PaymentProvider;
  aiConfigured?: boolean;
  now?: () => Date;
  baseUrl?: string;
}
export function createInitialState(mode: AppMode, nowDate = new Date(), collectionId?: DemoCollectionId): DomainState {
  if (mode !== 'rehearsal' && collectionId !== undefined) throw new DomainError('REHEARSAL_ONLY', 'Examples are available only in the demo rehearsal.', 403);
  const rehearsalCollectionId = mode === 'rehearsal' ? collectionId ?? DEFAULT_DEMO_COLLECTION_ID : undefined;
  return { schemaVersion: 1, revision: 0, mode, ...(rehearsalCollectionId ? { rehearsalCollectionId } : {}),
    collection: createCollection(nowDate, rehearsalCollectionId ?? 'illustrations'), participants: createParticipants(),
    plans: [], operations: {}, paymentCommands: {}, packing: [], webhookEventIds: [], invitationTokens: {}, rehearsalCaptureOutcome: 'success' };
}
const denied = (reason: string) => ({ allowed: false, reason });
const allowed = () => ({ allowed: true });
const money = (value: unknown, field: string, allowZero = true): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 100000000)
    throw new DomainError('INVALID_MONEY', 'Enter a valid amount to the nearest grosz.', 400, { [field]: 'Invalid amount.' });
  return value;
};
const textField = (value: unknown, field: string, maximum = 2000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new DomainError('INVALID_FIELD', 'Complete the required fields.', 400, { [field]: 'Check this field.' });
  return value.trim();
};
const isUnknown = (op: PaymentOperation | undefined) => !!op && ['STARTED', 'UNKNOWN', 'PENDING'].includes(op.status);
const isFinal = (op: PaymentOperation | undefined) => !!op && ['COMPLETED', 'AUTHORIZED', 'VOIDED', 'FAILED', 'CANCELLED'].includes(op.status);
const consentValid = (plan: AllocationPlan, assignment: Assignment) => plan.consents[assignment.buyerId]?.termsDigest === assignment.termsDigest;
const sorted = (ids: string[]) => [...ids].sort();
const clone = <T>(value: T): T => structuredClone(value);
function providerErrorInfo(error: unknown): PaymentOperation['providerError'] {
  if (!(error instanceof PayPalProviderError)) return undefined;
  const safeCode = (value: string) => /^[A-Z0-9_]{1,80}$/.test(value);
  return {
    code: error.issues.find(safeCode) ?? (safeCode(error.code) ? error.code : 'PAYPAL_ERROR'),
    ...(Number.isInteger(error.httpStatus) && error.httpStatus! >= 100 && error.httpStatus! <= 599 ? { httpStatus: error.httpStatus } : {}),
    ...(error.debugId && /^[A-Za-z0-9-]{1,128}$/.test(error.debugId) ? { debugId: error.debugId } : {}),
  };
}

/** The digest deliberately excludes version and the identities of the other buyers. */
export function termsDigest(collection: Collection, buyerId: BuyerId, itemIds: string[], totalCents: number): string {
  const items = sorted(itemIds).map(id => {
    const item = collection.items.find(i => i.id === id)!;
    return { id: item.id, name: item.name, description: item.description, condition: item.condition, imageUrl: item.imageUrl, shareCents: item.shareCents };
  });
  return createHash('sha256').update(JSON.stringify({ seller: 'kasia', collectionId: collection.id, buyerId,
    items, totalCents, currency: collection.currency, costRule: 'fixed-item-shares-plus-one-quarter-shared-cost',
    sharedCostCents: collection.sharedCostCents / collection.buyerCount, reservationExpiresAt: collection.reservationExpiresAt,
    fulfillment: 'Six items in one parcel. Organizer manually confirms packing and shipment.' })).digest('hex');
}

/** Exact bounded solver: every buyer gets six allowed items; fixed prices never use budget as a bid. */
export function solveAllocation(collection: Collection, participants: Participant[]): Assignment[] | NoSolution {
  const buyers = participants.filter(p => p.active);
  const limitsTotalCents = buyers.reduce((sum, p) => sum + (p.preferences?.budgetCents ?? 0), 0);
  const previousPreferred = new Set(buyers.flatMap(p => p.preferences?.preferredItemIds ?? []));
  const no = (code: NoSolution['code'], message: string): NoSolution => ({ code, message, activeBuyerCount: buyers.length,
    requiredBuyerCount: collection.buyerCount, totalCents: collection.totalCents, limitsTotalCents,
    shortfallCents: Math.max(0, collection.totalCents - limitsTotalCents),
    unassignedItemIds: collection.items.filter(i => !previousPreferred.has(i.id)).map(i => i.id) });
  if (buyers.length !== collection.buyerCount)
    return no('BUYER_COUNT', 'No complete split is available. This arrangement cannot proceed with the purchase. Four active buyers are required.');
  if (buyers.some(p => !p.preferences?.alternativesConfirmed || !p.preferences?.submittedAt))
    return no('MISSING_PREFERENCES', 'Waiting for six preferred items, a budget limit, and explicit confirmation of alternatives from each buyer.');
  if (limitsTotalCents < collection.totalCents) return no('INSUFFICIENT_BUDGET', 'No complete split fits the saved budgets. This arrangement cannot proceed with the purchase.');
  const cost = collection.sharedCostCents / collection.buyerCount;
  type Candidate = { ids: string[]; mask: number; base: number; alternatives: string[] };
  const candidates = buyers.map(buyer => {
    const prefs = buyer.preferences!;
    const accepted = new Set([...prefs.preferredItemIds, ...prefs.alternativeItemIds]);
    const preferred = new Set(prefs.preferredItemIds);
    const available = collection.items.map((item, index) => ({ ...item, bit: 1 << index })).filter(item => accepted.has(item.id));
    const result: Candidate[] = [];
    function choose(start: number, ids: string[], alternatives: string[], mask: number, base: number) {
      if (base + cost > prefs.budgetCents) return;
      if (ids.length === collection.itemsPerBuyer) { result.push({ ids, alternatives, mask, base }); return; }
      const needed = collection.itemsPerBuyer - ids.length;
      for (let index = start; index <= available.length - needed; index++) {
        const item = available[index];
        choose(index + 1, [...ids, item.id], preferred.has(item.id) ? alternatives : [...alternatives, item.id], mask | item.bit, base + item.shareCents);
      }
    }
    choose(0, [], [], 0, 0);
    result.sort((a, b) => a.alternatives.length - b.alternatives.length || a.ids.join(',').localeCompare(b.ids.join(',')));
    return result;
  });
  if (candidates.some(c => !c.length)) return no('NO_ALLOCATION', 'No complete split of acceptable items fits the saved budgets.');
  const order = buyers.map((_, i) => i).sort((a, b) => candidates[a].length - candidates[b].length || a - b);
  const preferredByAnyone = new Set(buyers.flatMap(p => p.preferences!.preferredItemIds));
  const lowerBound = collection.items.filter(item => !preferredByAnyone.has(item.id)).length;
  let best: Candidate[] | undefined;
  let bestAlternatives = Infinity;
  const chosen: Candidate[] = [];
  function search(depth: number, mask: number, altCount: number): boolean {
    if (altCount >= bestAlternatives) return false;
    if (depth === order.length) {
      if (mask !== (1 << collection.items.length) - 1) return false;
      best = [...chosen]; bestAlternatives = altCount;
      return bestAlternatives === lowerBound;
    }
    const index = order[depth];
    for (const candidate of candidates[index]) {
      if (candidate.mask & mask || altCount + candidate.alternatives.length >= bestAlternatives) continue;
      chosen[index] = candidate;
      if (search(depth + 1, mask | candidate.mask, altCount + candidate.alternatives.length)) return true;
    }
    return false;
  }
  search(0, 0, 0);
  if (!best) return no('NO_ALLOCATION', 'No complete split of acceptable items fits the saved budgets.');
  const allocation = best as Candidate[];
  return buyers.map((buyer, index) => {
    const candidate = allocation[index];
    const totalCents = candidate.base + cost;
    return { buyerId: buyer.id, itemIds: candidate.ids, baseCents: candidate.base, sharedCostCents: cost,
      totalCents, alternativeItemIds: candidate.alternatives, termsDigest: termsDigest(collection, buyer.id, candidate.ids, totalCents) };
  });
}

export class LotSplitEngine {
  private readonly now: () => Date;
  private readonly baseUrl: string;
  constructor(readonly store: SqliteStore<DomainState>, readonly options: EngineOptions) {
    this.now = options.now ?? (() => new Date()); this.baseUrl = options.baseUrl ?? 'http://localhost:5173';
    const state = store.initialize(createInitialState(options.mode, this.now()));
    if (state.mode !== options.mode) throw new Error('Stored mode differs from configured mode. Use a separate LOTSPLIT_DB for each mode.');
  }
  private time() { return this.now().toISOString(); }
  snapshot(): DomainState { return this.store.load()!; }
  private mutate<T>(change: (state: DomainState) => T): T {
    const state = this.snapshot(); const revision = state.revision;
    const result = change(state); state.revision = revision + 1;
    try { this.store.save(state, revision); }
    catch (error) { if ((error as Error).message === 'STATE_CONFLICT') throw new DomainError('STATE_CONFLICT', 'The data has changed. Refresh the page.', 409); throw error; }
    return result;
  }
  checkRevision(revision: unknown) {
    if (revision !== undefined && revision !== this.snapshot().revision) throw new DomainError('STALE_REVISION', 'The data has changed. Refresh the page.', 409);
  }
  private organizer(userId: UserId) { if (userId !== 'kasia') throw new DomainError('FORBIDDEN', 'This action is available to the organizer.', 403); }
  private buyer(userId: UserId): BuyerId { if (userId === 'kasia') throw new DomainError('FORBIDDEN', 'This action requires the buyer’s separate consent.', 403); return userId; }
  private participant(state: DomainState, buyerId: BuyerId) { const p = state.participants.find(p => p.id === buyerId); if (!p) throw new DomainError('NOT_FOUND', 'Participant not found.', 404); return p; }
  private current(state: DomainState) { return state.plans.find(p => p.id === state.currentPlanId); }
  private requireCurrent(state: DomainState, planId?: string) {
    const plan = this.current(state);
    if (!plan || (planId && plan.id !== planId) || plan.status === 'invalidated') throw new DomainError('STALE_PLAN', 'This plan version is out of date. Check the current plan.', 409);
    return plan;
  }
  private op(state: DomainState, id: string | undefined) { return id ? state.operations[id] : undefined; }
  private payment(state: DomainState, plan: AllocationPlan, buyerId: BuyerId): PaymentView {
    const p = plan.payments[buyerId] ?? {};
    return { order: this.op(state, p.orderOperationId), authorization: this.op(state, p.authorizationOperationId), capture: this.op(state, p.captureOperationId), void: this.op(state, p.voidOperationId), refund: this.op(state, p.refundOperationId) };
  }
  private expired(state: DomainState) { return Date.parse(state.collection.reservationExpiresAt) <= this.now().getTime(); }
  private captureStarted(state: DomainState) { return Object.values(state.operations).some(op => op.kind === 'capture'); }
  private editingAllowed(state: DomainState) {
    return !state.plans.some(plan => plan.assignments.some(a => {
      const payment = this.payment(state, plan, a.buyerId);
      if (!payment.capture) return false;
      if (['capturing', 'reconciling', 'paid'].includes(plan.status)) return true;
      if (isUnknown(payment.capture) || isUnknown(payment.refund) || isUnknown(payment.void)) return true;
      if (payment.capture.status === 'COMPLETED') return payment.refund?.status !== 'COMPLETED';
      return plan.assignments.some(other => {
        const remaining = this.payment(state, plan, other.buyerId);
        return remaining.authorization?.status === 'AUTHORIZED' && remaining.capture?.status !== 'COMPLETED' && remaining.void?.status !== 'VOIDED';
      });
    }));
  }
  private allAgreements(plan: AllocationPlan | undefined) { return !!plan && plan.assignments.length === 4 && plan.assignments.every(a => consentValid(plan, a)); }
  private authorizationReady(state: DomainState, plan: AllocationPlan, assignment: Assignment) {
    const payment = this.payment(state, plan, assignment.buyerId); const auth = payment.authorization;
    return auth?.status === 'AUTHORIZED' && auth.planId === plan.id && auth.buyerId === assignment.buyerId &&
      auth.amountCents === assignment.totalCents && auth.currency === state.collection.currency && !!auth.providerId &&
      (!auth.expiresAt || Date.parse(auth.expiresAt) > this.now().getTime()) && !payment.void && !payment.refund;
  }
  private currentCaptureTerms(state: DomainState, plan: AllocationPlan) {
    const active = state.participants.filter(p => p.active);
    return state.currentPlanId === plan.id && state.collection.catalogStatus === 'confirmed' &&
      active.length === state.collection.buyerCount && plan.assignments.length === active.length &&
      new Set(plan.assignments.map(a => a.buyerId)).size === active.length && this.allAgreements(plan) &&
      plan.assignments.every(a => active.some(p => p.id === a.buyerId) &&
        a.termsDigest === termsDigest(state.collection, a.buyerId, a.itemIds, a.totalCents));
  }
  private priorPaymentBlocked(state: DomainState, currentId: string) {
    return state.plans.filter(p => p.id !== currentId).some(plan => plan.assignments.some(a => {
      const payment = this.payment(state, plan, a.buyerId);
      if (isUnknown(payment.order) || isUnknown(payment.authorization) || isUnknown(payment.capture) || isUnknown(payment.void) || isUnknown(payment.refund)) return true;
      if (payment.authorization?.status === 'AUTHORIZED' && payment.void?.status !== 'VOIDED' && payment.capture?.status !== 'COMPLETED') return true;
      if (payment.capture?.status === 'COMPLETED' && payment.refund?.status !== 'COMPLETED') return true;
      return payment.order?.status === 'CREATED' && !payment.authorization;
    }));
  }
  private gates(state: DomainState, buyerId?: BuyerId): Gates {
    const collection = state.collection; const plan = this.current(state); const valid = plan && plan.status !== 'invalidated';
    const active = state.participants.filter(p => p.active); const allAgreed = this.allAgreements(plan);
    const editable = this.editingAllowed(state); const reservationOk = !this.expired(state);
    const previousBlocked = !!plan && this.priorPaymentBlocked(state, plan.id);
    const paymentReady = this.options.mode === 'rehearsal' || !!this.options.paymentProvider;
    const readyAuthorizations = !!plan && this.currentCaptureTerms(state, plan) && plan.assignments.every(a => this.authorizationReady(state, plan, a));
    let authorize = !valid || !allAgreed ? denied('Waiting for all valid agreements to the current plan.')
      : !reservationOk ? denied('The collection reservation has expired.') : previousBlocked ? denied('Payments for the previous version must be resolved first.')
      : !paymentReady ? denied('PayPal sandbox is not configured.') : !['sent'].includes(plan.status) ? denied('Payments for this plan are being settled.') : allowed();
    if (buyerId) {
      const participant = this.participant(state, buyerId); const own = plan?.assignments.find(a => a.buyerId === buyerId);
      const payment = plan ? this.payment(state, plan, buyerId) : {};
      if (!participant.active || !own) authorize = denied('You are not an active participant in the current plan.');
      else if (!participant.address) authorize = denied('Add your delivery address.');
      else if (isUnknown(payment.order) || isUnknown(payment.authorization)) authorize = denied('We are checking the result of the existing operation.');
      else if (payment.authorization?.status === 'AUTHORIZED') authorize = denied('Authorization is ready. No payment has been captured.');
    }
    return {
      confirmCatalog: editable ? allowed() : denied('Payments are being settled.'),
      solve: collection.catalogStatus !== 'confirmed' ? denied('Confirm the catalog and item shares first.') : !editable ? denied('Payments are being settled.') : allowed(),
      sendPlan: !valid || plan.status !== 'draft' ? denied('Calculate a current, complete plan first.') : allowed(),
      agree: !valid || !['sent'].includes(plan.status) ? denied('Waiting for the current plan to be sent.')
        : buyerId && !plan.assignments.some(a => a.buyerId === buyerId) ? denied('You are not a participant in this version.') : allowed(),
      authorize,
      capture: !valid || plan.status !== 'sent' ? denied('The plan is not ready for payment capture.') : !reservationOk ? denied('The collection reservation has expired.')
        : !allAgreed ? denied('Waiting for all valid agreements.') : previousBlocked ? denied('Previous operations need to be resolved.')
        : !readyAuthorizations ? denied('Waiting for four valid authorizations for the correct amounts.') : !paymentReady ? denied('PayPal sandbox is not configured.') : allowed(),
      packing: valid && plan.status === 'paid' && plan.assignments.length === 4 && plan.assignments.every(a => {
        const payment = this.payment(state, plan, a.buyerId); return payment.capture?.status === 'COMPLETED' && !payment.refund;
      }) ? allowed() : denied('Packing requires four confirmed COMPLETED captures for one valid plan.'),
      editPreferences: editable && collection.catalogStatus === 'confirmed' ? allowed() : denied(editable ? 'The catalog has not been confirmed yet.' : 'Payments are being settled.'),
      withdraw: editable ? allowed() : denied('Payment capture has started. Payments must be resolved first.'),
    };
  }
  private requireGate(gate: { allowed: boolean; reason?: string }, code = 'GATE_CLOSED') { if (!gate.allowed) throw new DomainError(code, gate.reason ?? 'This action is currently unavailable.', 409); }

  view(userId?: UserId): AppView {
    const state = this.snapshot();
    // A missing discriminator belongs to a historical illustration demo; do not migrate stored data on reads.
    const rehearsalCollectionId = state.mode === 'rehearsal' ? state.rehearsalCollectionId ?? 'illustrations' : undefined;
    if (!userId) return { authenticated: false, mode: this.options.mode, rehearsalCollectionId, demoAccess: this.options.mode === 'rehearsal' ? clone(DEMO_ACCESS) : [], paymentConfigured: !!this.options.paymentProvider, aiConfigured: !!this.options.aiConfigured };
    const plan = this.current(state); const isOrganizer = userId === 'kasia';
    const gates = this.gates(state, isOrganizer ? undefined : userId);
    const progress = { activeBuyers: state.participants.filter(p => p.active).length, requiredBuyers: state.collection.buyerCount,
      preferences: state.participants.filter(p => p.active && p.preferences?.submittedAt).length,
      agreements: plan?.status === 'invalidated' ? 0 : plan?.assignments.filter(a => consentValid(plan, a)).length ?? 0,
      authorizations: plan?.status === 'invalidated' ? 0 : plan?.assignments.filter(a => this.payment(state, plan, a.buyerId).authorization?.status === 'AUTHORIZED' && !this.payment(state, plan, a.buyerId).void).length ?? 0,
      captures: plan?.assignments.filter(a => this.payment(state, plan, a.buyerId).capture?.status === 'COMPLETED').length ?? 0 };
    const base = { authenticated: true as const, mode: state.mode, rehearsalCollectionId, me: userForId(userId), revision: state.revision, progress, gates,
      reservationExpired: this.expired(state), paymentConfigured: !!this.options.paymentProvider, aiConfigured: !!this.options.aiConfigured,
      simulationNotice: state.mode === 'rehearsal' ? 'Payment rehearsal. Payments are simulated; there is no connection to PayPal.' : undefined };
    const previousFor = (buyerId: BuyerId) => {
      const older = state.plans.filter(p => p.version < (plan?.version ?? 0)).reverse().find(p => p.assignments.some(a => a.buyerId === buyerId));
      const assignment = older?.assignments.find(a => a.buyerId === buyerId);
      return assignment ? { itemIds: assignment.itemIds, totalCents: assignment.totalCents } : undefined;
    };
    if (isOrganizer) return clone({ ...base, role: 'organizer', collection: state.collection,
      participants: state.participants.map(p => gates.packing.allowed ? p : { ...p, address: undefined }),
      plan: plan ? { id: plan.id, version: plan.version, status: plan.status, createdAt: plan.createdAt, sentAt: plan.sentAt,
        failureReason: plan.failureReason, invalidationReason: plan.invalidationReason,
        assignments: plan.assignments.map(a => ({ ...a, buyerName: this.participant(state, a.buyerId).name,
          budgetCents: this.participant(state, a.buyerId).preferences?.budgetCents ?? 0, consent: plan.consents[a.buyerId],
          payment: this.payment(state, plan, a.buyerId), previous: previousFor(a.buyerId) })) } : undefined,
      noSolution: state.noSolution, invitations: state.participants.map(p => ({ buyerId: p.id, name: p.name,
        url: `/invite/${state.mode === 'rehearsal' ? `demo-${p.id}` : state.invitationTokens[p.id] ?? ''}`, active: p.active })),
      packing: gates.packing.allowed ? state.packing : [], rehearsalCaptureOutcome: state.rehearsalCaptureOutcome });
    const participant = this.participant(state, userId); const assignment = plan?.assignments.find(a => a.buyerId === userId);
    const { items, ...collection } = state.collection;
    const shipment = state.packing.find(p => p.buyerId === userId);
    return clone({ ...base, role: 'buyer', collection: { ...collection, items: items.map(({ shareCents: _share, ...item }) => item) },
      participant, plan: plan && assignment && plan.status !== 'draft' ? { id: plan.id, version: plan.version, status: plan.status,
        assignment, consent: plan.consents[userId], payment: this.payment(state, plan, userId), previous: previousFor(userId),
        failureReason: plan.failureReason, invalidationReason: plan.invalidationReason } : undefined,
      noSolution: state.noSolution ? { message: state.noSolution.message } : undefined,
      shipment: shipment ? { packedAt: shipment.packedAt, shippedAt: shipment.shippedAt } : undefined,
      demoDefaults: getDemoDefaults(rehearsalCollectionId, userId) });
  }

  updateCollection(userId: UserId, input: Record<string, unknown>) {
    this.organizer(userId); this.mutate(state => {
      if (!this.editingAllowed(state)) throw new DomainError('PAYMENTS_STARTED', 'Payments are being settled.', 409);
      const financial = input.collectionPriceCents !== undefined || input.sharedCostCents !== undefined;
      if (financial && state.collection.preferencesOpened) throw new DomainError('SHARES_LOCKED', 'Set costs and item shares before collecting budget limits.', 409);
      const c = state.collection;
      if (input.name !== undefined) c.name = textField(input.name, 'name', 160);
      if (input.description !== undefined) c.description = textField(input.description, 'description');
      if (input.collectionPriceCents !== undefined) c.collectionPriceCents = money(input.collectionPriceCents, 'collectionPriceCents', false);
      if (input.sharedCostCents !== undefined) { c.sharedCostCents = money(input.sharedCostCents, 'sharedCostCents'); if (c.sharedCostCents % 4) throw new DomainError('INVALID_COST', 'The cost must divide exactly between four buyers.'); }
      if (input.photos !== undefined) {
        if (!Array.isArray(input.photos) || !input.photos.length || input.photos.length > 12 || input.photos.some(p => typeof p !== 'string' || !safeImage(p))) throw new DomainError('INVALID_PHOTOS', 'Add valid collection photos.');
        c.photos = input.photos as string[];
      }
      if (input.reservationExpiresAt !== undefined) {
        const iso = textField(input.reservationExpiresAt, 'reservationExpiresAt', 100);
        if (!Number.isFinite(Date.parse(iso))) throw new DomainError('INVALID_DATE', 'Enter a valid reservation deadline.');
        if (iso !== c.reservationExpiresAt) { c.reservationExpiresAt = new Date(iso).toISOString(); this.invalidate(state, 'The reservation deadline changed.'); }
      }
      c.totalCents = c.collectionPriceCents + c.sharedCostCents;
      if (financial) { c.catalogStatus = 'draft'; this.invalidate(state, 'The collection costs changed.'); }
    });
  }
  updateItem(userId: UserId, itemId: string, input: Record<string, unknown>) {
    this.organizer(userId); this.mutate(state => {
      if (!this.editingAllowed(state)) throw new DomainError('PAYMENTS_STARTED', 'Payments are being settled.', 409);
      const item = state.collection.items.find(i => i.id === itemId); if (!item) throw new DomainError('NOT_FOUND', 'Item not found.', 404);
      if (input.shareCents !== undefined && state.collection.preferencesOpened) throw new DomainError('SHARES_LOCKED', 'Item shares are locked after preference collection begins.', 409);
      for (const key of ['name', 'description', 'condition'] as const) if (input[key] !== undefined) item[key] = textField(input[key], key);
      if (input.imageUrl !== undefined) { const url = textField(input.imageUrl, 'imageUrl', 10000000); if (!safeImage(url)) throw new DomainError('INVALID_IMAGE', 'Invalid image address.'); item.imageUrl = url; }
      if (input.shareCents !== undefined) item.shareCents = money(input.shareCents, 'shareCents');
      if (input.confirmed !== undefined) { if (typeof input.confirmed !== 'boolean') throw new DomainError('INVALID_CONFIRMATION', 'Confirm the item.'); item.confirmed = input.confirmed; if (input.confirmed) item.needsReview = false; }
      state.collection.catalogStatus = 'draft';
      state.collection.catalogVersion++;
      this.invalidate(state, 'Important item details changed.');
    });
  }
  confirmCatalog(userId: UserId) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).confirmCatalog);
      const c = state.collection;
      if (c.items.length !== 24 || new Set(c.items.map(i => i.id)).size !== 24 || c.items.some(i => !i.confirmed || i.needsReview || !i.condition || !safeImage(i.imageUrl)))
        throw new DomainError('CATALOG_INCOMPLETE', 'Review and confirm all 24 items.');
      if (c.items.some(i => !Number.isSafeInteger(i.shareCents) || i.shareCents < 0) || c.items.reduce((sum, i) => sum + i.shareCents, 0) !== c.collectionPriceCents)
        throw new DomainError('SHARE_SUM', 'The item shares must add up to the collection price.');
      c.catalogStatus = 'confirmed'; c.preferencesOpened = true;
    });
  }
  invite(userId: UserId, buyerId: BuyerId) {
    this.organizer(userId); return this.mutate(state => {
      const participant = this.participant(state, buyerId); participant.invitedAt = this.time();
      const token = state.mode === 'rehearsal' ? `demo-${buyerId}` : randomUUID() + randomUUID();
      state.invitationTokens[buyerId] = token;
      return `/invite/${token}`;
    });
  }
  invitationUser(token: string): UserId | undefined {
    const state = this.snapshot();
    if (state.mode === 'rehearsal' && token.startsWith('demo-')) return DEMO_ACCESS.some(a => a.inviteToken === token) ? token.slice(5) as UserId : undefined;
    return (Object.entries(state.invitationTokens).find(([, t]) => t === token)?.[0]) as UserId | undefined;
  }
  savePreferences(userId: UserId, input: Record<string, unknown>) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      this.requireGate(this.gates(state, buyerId).editPreferences); const participant = this.participant(state, buyerId);
      if (!participant.active) throw new DomainError('INACTIVE', 'This participant slot is not currently active.', 409);
      const ids = this.validIds(state, input.preferredItemIds, 'preferredItemIds');
      if (ids.length !== state.collection.itemsPerBuyer) throw new DomainError('PREFERRED_COUNT', 'Choose exactly six preferred items.');
      const budgetCents = money(input.budgetCents, 'budgetCents', false);
      participant.preferences = { preferredItemIds: ids, alternativeItemIds: [], alternativesConfirmed: false, budgetCents, updatedAt: this.time() };
      this.invalidate(state, 'Preferences or the budget limit changed. Recalculate the plan.');
    });
  }
  saveAlternatives(userId: UserId, input: Record<string, unknown>) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      this.requireGate(this.gates(state, buyerId).editPreferences); const participant = this.participant(state, buyerId); const prefs = participant.preferences;
      if (!participant.active || !prefs) throw new DomainError('PREFERENCES_REQUIRED', 'Save six preferred items and a budget limit first.', 409);
      if (input.confirmed !== true) throw new DomainError('ALTERNATIVES_CONFIRMATION', 'Explicitly confirm your alternatives or that you accept none.');
      const ids = this.validIds(state, input.alternativeItemIds, 'alternativeItemIds');
      if (ids.some(id => prefs.preferredItemIds.includes(id))) throw new DomainError('ALTERNATIVES_OVERLAP', 'Preferred items cannot also be alternatives.');
      prefs.alternativeItemIds = ids; prefs.alternativesConfirmed = true; prefs.submittedAt = this.time(); prefs.updatedAt = this.time();
      this.invalidate(state, 'Acceptable alternatives changed. Recalculate the plan.');
    });
  }
  private validIds(state: DomainState, value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !state.collection.items.some(i => i.id === id)) || new Set(value).size !== value.length)
      throw new DomainError('INVALID_ITEMS', 'Check the selected item IDs.', 400, { [field]: 'Invalid or duplicate item.' });
    return sorted(value as string[]);
  }
  private invalidate(state: DomainState, reason: string) {
    const plan = this.current(state); if (!plan || plan.status === 'invalidated') return;
    if (!this.editingAllowed(state)) throw new DomainError('PAYMENTS_STARTED', 'Payments are being settled.', 409);
    plan.status = 'invalidated'; plan.invalidatedAt = this.time(); plan.invalidationReason = reason; state.packing = []; state.noSolution = undefined;
  }
  solve(userId: UserId) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).solve);
      const result = solveAllocation(state.collection, state.participants);
      const previous = this.current(state);
      if (!Array.isArray(result)) { if (previous && previous.status !== 'invalidated') this.invalidate(state, 'No complete solution is available.'); state.noSolution = result; return; }
      if (previous && previous.status !== 'invalidated') this.invalidate(state, 'A new plan version was calculated.');
      const plan: AllocationPlan = { id: randomUUID(), version: Math.max(0, ...state.plans.map(p => p.version)) + 1,
        status: 'draft', assignments: result, consents: {}, payments: {}, createdAt: this.time() };
      for (const assignment of result) {
        const participant = this.participant(state, assignment.buyerId);
        const past = previous && previous.assignments.some(a => a.buyerId === assignment.buyerId && a.termsDigest === assignment.termsDigest && consentValid(previous, a)) &&
          (!participant.withdrawnAt || previous.consents[assignment.buyerId]!.acceptedAt > participant.withdrawnAt) &&
          !Object.values(state.operations).some(op => op.planId === previous.id && op.kind === 'capture') ? previous : undefined;
        if (past) { const consent = past.consents[assignment.buyerId]!; plan.consents[assignment.buyerId] = { ...consent, preservedFromPlanId: past.id }; }
      }
      state.plans.push(plan); state.currentPlanId = plan.id; state.noSolution = undefined;
    });
  }
  sendPlan(userId: UserId, planId: string) { this.organizer(userId); this.mutate(state => { const plan = this.requireCurrent(state, planId); this.requireGate(this.gates(state).sendPlan); plan.status = 'sent'; plan.sentAt = this.time(); }); }
  agree(userId: UserId, planId: string, digest: string) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      const plan = this.requireCurrent(state, planId); this.requireGate(this.gates(state, buyerId).agree);
      const assignment = plan.assignments.find(a => a.buyerId === buyerId)!;
      if (digest !== assignment.termsDigest) throw new DomainError('TERMS_CHANGED', 'The terms changed. Review your exact current allocation and amount.', 409);
      plan.consents[buyerId] = { buyerId, termsDigest: digest, acceptedAt: this.time(), sourcePlanId: plan.id };
    });
  }
  async withdraw(userId: UserId) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).withdraw); const participant = this.participant(state, buyerId);
      participant.active = false; participant.withdrawnAt = this.time(); this.invalidate(state, `${participant.name} withdrew from the purchase.`);
      const result = solveAllocation(state.collection, state.participants); if (!Array.isArray(result)) state.noSolution = result;
    });
    await this.compensateInvalidPlans();
  }
  async replace(userId: UserId, leavingBuyerId: BuyerId, replacementBuyerId: BuyerId) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).withdraw);
      if (leavingBuyerId === replacementBuyerId) throw new DomainError('INVALID_REPLACEMENT', 'Choose a different person.');
      const leaving = this.participant(state, leavingBuyerId), replacement = this.participant(state, replacementBuyerId);
      if (replacement.active) throw new DomainError('ALREADY_ACTIVE', 'This person is already active.');
      leaving.active = false; leaving.withdrawnAt = this.time(); replacement.active = true; replacement.invitedAt = this.time();
      this.invalidate(state, `${replacement.name} replaces ${leaving.name}.`); state.noSolution = undefined;
    });
    await this.compensateInvalidPlans();
  }
  saveAddress(userId: UserId, input: Record<string, unknown>) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      const plan = this.requireCurrent(state); if (!this.allAgreements(plan)) throw new DomainError('AGREEMENTS_REQUIRED', 'All valid agreements are required first.', 409);
      if (plan.status !== 'sent') throw new DomainError('PAYMENTS_STARTED', 'Payments for this plan are being settled.', 409);
      const payment = this.payment(state, plan, buyerId); if (payment.authorization && !['FAILED', 'CANCELLED', 'VOIDED'].includes(payment.authorization.status)) throw new DomainError('ADDRESS_LOCKED', 'The address is linked to the payment being prepared.', 409);
      const address: DeliveryAddress = { recipient: textField(input.recipient, 'recipient', 160), street: textField(input.street, 'street', 200),
        postalCode: textField(input.postalCode, 'postalCode', 30), city: textField(input.city, 'city', 100), country: textField(input.country, 'country', 80) };
      this.participant(state, buyerId).address = address;
    });
  }

  private prepareOperation(state: DomainState, plan: AllocationPlan, buyerId: BuyerId, kind: OperationKind, parentProviderId?: string): PaymentOperation {
    const assignment = plan.assignments.find(a => a.buyerId === buyerId);
    if (!assignment) throw new DomainError('NOT_IN_PLAN', 'You are not a participant in this version.', 403);
    const id = randomUUID();
    const operation: PaymentOperation = { id, idempotencyKey: `lotsplit-${kind}-${id}`, kind, buyerId, planId: plan.id,
      amountCents: assignment.totalCents, currency: state.collection.currency, status: 'STARTED', source: sourceForMode(state.mode),
      parentProviderId, createdAt: this.time(), updatedAt: this.time(), checkNeeded: true, reconcileAttempts: 0 };
    state.operations[id] = operation;
    const command: FrozenPaymentCommand = kind === 'order' ? { kind, input: { amountCents: operation.amountCents, currency: operation.currency,
      description: `LOTSPLIT ${operation.planId} / ${operation.buyerId}`, customId: operation.id, idempotencyKey: operation.idempotencyKey,
      returnUrl: `${this.baseUrl}/payment/return?operationId=${encodeURIComponent(operation.id)}`,
      cancelUrl: `${this.baseUrl}/payment/cancel?operationId=${encodeURIComponent(operation.id)}` } }
      : kind === 'authorize' || kind === 'void' ? { kind, providerId: parentProviderId!, idempotencyKey: operation.idempotencyKey }
      : { kind, providerId: parentProviderId!, amountCents: operation.amountCents, currency: operation.currency, idempotencyKey: operation.idempotencyKey };
    (state.paymentCommands ??= {})[id] = { command, attempts: 0 };
    const payment = plan.payments[buyerId] ??= {};
    const field: Record<OperationKind, keyof BuyerPayment> = { order: 'orderOperationId', authorize: 'authorizationOperationId', capture: 'captureOperationId', void: 'voidOperationId', refund: 'refundOperationId' };
    payment[field[kind]] = id;
    return clone(operation);
  }
  /** The operation ID and idempotency key are committed before any provider request. */
  private async dispatch(operation: PaymentOperation, recovering = false): Promise<void> {
    const leaseToken = randomUUID();
    const saved = this.mutate(state => {
      const current = state.operations[operation.id]; if (!current || isFinal(current)) return undefined;
      const saved = state.paymentCommands?.[operation.id];
      if (!saved) { current.lastError = 'No saved provider command was found. This operation needs manual reconciliation; no new charge will be created.'; return undefined; }
      if (saved.leaseExpiresAt && Date.parse(saved.leaseExpiresAt) > this.now().getTime()) return undefined;
      if (recovering) {
        const age = this.now().getTime() - Date.parse(current.createdAt);
        if (!Number.isFinite(age) || age < 0 || age >= SAFE_REPLAY_WINDOW_MS) {
          current.status = 'UNKNOWN'; current.checkNeeded = true;
          current.lastError = 'The safe retry window for this operation has expired. Manual reconciliation with PayPal is required; no new charge will be created.';
          return undefined;
        }
        const plan = state.plans.find(p => p.id === current.planId);
        if (['authorize', 'capture'].includes(current.kind) && (!plan || this.expired(state) || !this.currentCaptureTerms(state, plan) ||
          this.priorPaymentBlocked(state, plan.id) || (current.kind === 'authorize' && plan.status !== 'sent') ||
          (current.kind === 'capture' && (!['capturing', 'reconciling'].includes(plan.status) ||
            !plan.assignments.every(a => this.payment(state, plan, a.buyerId).capture?.status === 'COMPLETED' || this.authorizationReady(state, plan, a)))))) {
          current.status = 'UNKNOWN'; current.checkNeeded = true; current.lastError = 'The current terms do not permit resubmission. We are checking the earlier result without creating a new charge.'; return undefined;
        }
      }
      saved.attempts++; saved.leaseToken = leaseToken; saved.leaseExpiresAt = new Date(this.now().getTime() + DISPATCH_LEASE_MS).toISOString();
      return clone(saved);
    });
    if (!saved) return;
    try {
      let result: ProviderResult;
      if (this.options.mode === 'rehearsal') result = this.rehearsalResult(operation, false);
      else {
        const provider = this.options.paymentProvider;
        if (!provider) throw new DomainError('PAYPAL_NOT_CONFIGURED', 'PayPal sandbox is not configured.', 503);
        const command = saved.command;
        switch (command.kind) {
          case 'order': result = await provider.createOrder(command.input); break;
          case 'authorize': result = await provider.authorizeOrder(command.providerId, command.idempotencyKey); break;
          case 'capture': result = await provider.captureAuthorization(command.providerId, command.amountCents, command.currency, command.idempotencyKey); break;
          case 'void': result = await provider.voidAuthorization(command.providerId, command.idempotencyKey); break;
          case 'refund': result = await provider.refundCapture(command.providerId, command.amountCents, command.currency, command.idempotencyKey); break;
        }
      }
      this.applyResult(operation.id, result);
    } catch (error) {
      this.mutate(state => {
        const op = state.operations[operation.id]; if (!op || isFinal(op)) return;
        // A rejected recovery request says nothing about whether the original request succeeded.
        const awaitingApproval = op.kind === 'authorize' && error instanceof PayPalProviderError && error.code === 'ORDER_NOT_APPROVED';
        const uncertain = recovering || ((error as { uncertain?: boolean }).uncertain !== false && !(error instanceof DomainError));
        op.status = awaitingApproval ? 'PENDING' : uncertain ? 'UNKNOWN' : 'FAILED'; op.checkNeeded = awaitingApproval || uncertain; op.updatedAt = this.time();
        op.lastError = awaitingApproval ? 'PayPal has not confirmed approval yet. Check the existing authorization before continuing.'
          : uncertain ? 'We are checking the saved operation result. The charge will not be repeated.' : 'The provider did not confirm the operation. Check the configuration or try again after it is resolved.';
        op.providerError = providerErrorInfo(error);
      });
    } finally {
      this.mutate(state => { const command = state.paymentCommands?.[operation.id]; if (command?.leaseToken === leaseToken) { delete command.leaseToken; delete command.leaseExpiresAt; } });
    }
  }
  private rehearsalResult(operation: PaymentOperation, reconciling: boolean): ProviderResult {
    const state = this.snapshot(); let status: ProviderResult['status'];
    if (operation.kind === 'order') status = 'CREATED';
    else if (operation.kind === 'authorize') status = 'AUTHORIZED';
    else if (operation.kind === 'capture') status = operation.buyerId === 'ola' && state.rehearsalCaptureOutcome !== 'success'
      ? state.rehearsalCaptureOutcome === 'unknown-ola' && !reconciling ? 'UNKNOWN' : 'FAILED' : 'COMPLETED';
    else status = reconciling ? operation.kind === 'refund' ? 'COMPLETED' : 'VOIDED' : 'PENDING';
    return { status, providerId: operation.providerId ?? `rehearsal-${operation.kind}-${operation.id}`, amountCents: operation.amountCents, currency: operation.currency,
      approvalUrl: operation.kind === 'order' ? `/payment/approve?operationId=${operation.id}` : undefined };
  }
  private applyResult(operationId: string, result: ProviderResult) {
    this.mutate(state => {
      const operation = state.operations[operationId]; if (!operation) throw new DomainError('NOT_FOUND', 'Operation not found.', 404);
      if (isFinal(operation)) return;
      const financialFinal = (operation.kind === 'authorize' && result.status === 'AUTHORIZED') ||
        (['capture', 'refund'].includes(operation.kind) && result.status === 'COMPLETED');
      const permitted: Record<OperationKind, string[]> = {
        order: ['CREATED', 'APPROVED', 'AUTHORIZED', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        authorize: ['AUTHORIZED', 'PENDING', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        capture: ['COMPLETED', 'PENDING', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        void: ['VOIDED', 'PENDING', 'FAILED', 'UNKNOWN'], refund: ['COMPLETED', 'PENDING', 'FAILED', 'UNKNOWN'],
      };
      if (!permitted[operation.kind].includes(result.status)) {
        operation.status = 'UNKNOWN'; operation.checkNeeded = true; operation.updatedAt = this.time();
        operation.lastError = 'The provider returned a status that needs checking.'; return;
      }
      if (financialFinal && (result.amountCents !== operation.amountCents || result.currency !== operation.currency)) {
        operation.status = 'UNKNOWN'; operation.checkNeeded = true; operation.updatedAt = this.time();
        operation.lastError = 'We are checking that the operation amount and currency match the exact plan.'; return;
      }
      operation.status = result.status; operation.providerId = result.providerId || operation.providerId;
      operation.approvalUrl = result.approvalUrl ?? operation.approvalUrl; operation.updatedAt = this.time();
      operation.checkNeeded = ['UNKNOWN', 'PENDING'].includes(result.status); operation.lastError = undefined; operation.providerError = undefined;
      if (operation.kind === 'authorize' && result.expiresAt) operation.expiresAt = result.expiresAt;
    });
  }
  async authorize(userId: UserId, planId: string): Promise<{ operationId: string; approvalUrl?: string }> {
    const buyerId = this.buyer(userId);
    const prepared = this.mutate(state => {
      const plan = this.requireCurrent(state, planId); const payment = this.payment(state, plan, buyerId);
      if (payment.order && !['FAILED', 'CANCELLED'].includes(payment.order.status)) {
        if (payment.order.planId !== plan.id) throw new DomainError('STALE_PLAN', 'This payment is out of date.', 409);
        return { operation: clone(payment.order), existing: true };
      }
      this.requireGate(this.gates(state, buyerId).authorize);
      return { operation: this.prepareOperation(state, plan, buyerId, 'order'), existing: false };
    });
    if (!prepared.existing) await this.dispatch(prepared.operation);
    await this.compensateInvalidPlans();
    const operation = this.snapshot().operations[prepared.operation.id];
    return { operationId: operation.id, approvalUrl: operation.approvalUrl };
  }
  async approve(userId: UserId, orderOperationId: string, outcome: 'approve' | 'decline' = 'approve') {
    const buyerId = this.buyer(userId);
    const prepared = this.mutate(state => {
      const order = state.operations[orderOperationId];
      if (!order || order.kind !== 'order' || order.buyerId !== buyerId) throw new DomainError('NOT_FOUND', 'Your operation was not found.', 404);
      const plan = this.requireCurrent(state, order.planId); const payment = this.payment(state, plan, buyerId);
      if (payment.authorization && !['FAILED', 'CANCELLED'].includes(payment.authorization.status)) return { operation: clone(payment.authorization), existing: true };
      // A repeated browser callback must never mint a replacement authorization command.
      if (payment.authorization?.status === 'FAILED' && payment.authorization.parentProviderId === order.providerId)
        return { operation: clone(payment.authorization), existing: true };
      this.requireGate(this.gates(state, buyerId).authorize);
      if (!['CREATED', 'APPROVED'].includes(order.status) || !order.providerId) throw new DomainError('ORDER_NOT_READY', 'We are checking the status of the existing operation.', 409);
      if (outcome === 'decline' && state.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'This control is available only in the demo rehearsal.', 403);
      const op = this.prepareOperation(state, plan, buyerId, 'authorize', order.providerId);
      if (outcome === 'decline') { state.operations[op.id].status = 'FAILED'; state.operations[op.id].checkNeeded = false; order.status = 'FAILED'; return { operation: clone(state.operations[op.id]), existing: true }; }
      return { operation: op, existing: false };
    });
    if (!prepared.existing) await this.dispatch(prepared.operation);
    await this.compensateInvalidPlans();
    return { operationId: prepared.operation.id };
  }
  cancelPayment(userId: UserId, orderOperationId: string) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      const order = state.operations[orderOperationId];
      if (!order || order.kind !== 'order' || order.buyerId !== buyerId) throw new DomainError('NOT_FOUND', 'Your operation was not found.', 404);
      const plan = state.plans.find(p => p.id === order.planId)!; const payment = this.payment(state, plan, buyerId);
      if (payment.authorization || !['CREATED', 'APPROVED'].includes(order.status)) throw new DomainError('PAYMENT_UNRESOLVED', 'The result of the existing operation must be checked first.', 409);
      order.status = 'CANCELLED'; order.checkNeeded = false; order.updatedAt = this.time();
    });
  }
  async capture(userId: UserId, planId: string) {
    this.organizer(userId);
    const start = this.mutate(state => {
      const plan = this.requireCurrent(state, planId);
      if (['capturing', 'reconciling', 'paid', 'failed'].includes(plan.status)) return false;
      this.requireGate(this.gates(state).capture); plan.status = 'capturing'; return true;
    });
    if (start) await this.continueCaptures(planId);
  }
  private async continueCaptures(planId: string) {
    for (;;) {
      const next = this.mutate(state => {
        const plan = state.plans.find(p => p.id === planId)!;
        if (!plan || !['capturing', 'reconciling'].includes(plan.status)) return { kind: 'stop' as const };
        const views = plan.assignments.map(a => this.payment(state, plan, a.buyerId));
        if (views.some(p => p.capture && ['FAILED', 'CANCELLED'].includes(p.capture.status))) {
          plan.status = 'failed'; plan.failureReason = 'One capture failed. The purchase is paused; confirmed captures are being refunded and the remaining authorizations voided.';
          return { kind: 'compensate' as const };
        }
        if (views.some(p => isUnknown(p.capture))) { plan.status = 'reconciling'; return { kind: 'stop' as const }; }
        if (views.every(p => p.capture?.status === 'COMPLETED')) {
          plan.status = 'paid';
          state.packing = plan.assignments.map(a => ({ buyerId: a.buyerId, buyerName: this.participant(state, a.buyerId).name,
            address: this.participant(state, a.buyerId).address!, itemIds: a.itemIds, totalCents: a.totalCents, checkedItemIds: [] }));
          return { kind: 'stop' as const };
        }
        const pendingAuthorizationsReady = plan.assignments.every((assignment, index) => views[index].capture?.status === 'COMPLETED' || this.authorizationReady(state, plan, assignment));
        if (this.expired(state) || !this.currentCaptureTerms(state, plan) || !pendingAuthorizationsReady || this.priorPaymentBlocked(state, plan.id) ||
          views.some(p => p.void || p.refund) || (state.mode === 'sandbox' && !this.options.paymentProvider)) {
          plan.status = 'failed'; plan.failureReason = 'The next capture cannot start: the reservation, authorization, or plan terms have expired. We are settling the operations already started.';
          return { kind: 'compensate' as const };
        }
        const index = views.findIndex(p => !p.capture); const assignment = plan.assignments[index]; const authorization = views[index].authorization;
        if (authorization?.status !== 'AUTHORIZED' || !authorization.providerId) { plan.status = 'failed'; plan.failureReason = 'No valid authorization is available. We are settling the operations already started.'; return { kind: 'compensate' as const }; }
        plan.status = 'capturing'; return { kind: 'dispatch' as const, operation: this.prepareOperation(state, plan, assignment.buyerId, 'capture', authorization.providerId) };
      });
      if (next.kind === 'compensate') { await this.compensatePlan(planId); return; }
      if (next.kind === 'stop') return;
      await this.dispatch(next.operation);
    }
  }
  private async compensateInvalidPlans() {
    for (const plan of this.snapshot().plans.filter(p => p.status === 'invalidated')) await this.compensatePlan(plan.id);
  }
  async processPendingCompensation() { await this.compensateInvalidPlans(); }
  private async compensatePlan(planId: string) {
    for (const assignment of this.snapshot().plans.find(p => p.id === planId)?.assignments ?? []) {
      const prepared = this.mutate(state => {
        const plan = state.plans.find(p => p.id === planId)!; const payment = this.payment(state, plan, assignment.buyerId);
        if (isUnknown(payment.capture) || isUnknown(payment.authorization) || isUnknown(payment.order)) return undefined;
        if (payment.capture?.status === 'COMPLETED') {
          if (!payment.refund && payment.capture.providerId) return this.prepareOperation(state, plan, assignment.buyerId, 'refund', payment.capture.providerId);
        } else if (payment.authorization?.status === 'AUTHORIZED') {
          if (!payment.void && payment.authorization.providerId) return this.prepareOperation(state, plan, assignment.buyerId, 'void', payment.authorization.providerId);
        } else if (payment.order && ['CREATED', 'APPROVED'].includes(payment.order.status) && !payment.authorization) {
          payment.order.status = 'CANCELLED'; payment.order.checkNeeded = false; payment.order.updatedAt = this.time();
        }
        return undefined;
      });
      if (prepared) await this.dispatch(prepared);
    }
  }
  async reconcile(userId: UserId, operationId?: string) {
    const state = this.snapshot();
    const operations = operationId ? [state.operations[operationId]].filter(Boolean) : Object.values(state.operations).filter(op => isUnknown(op));
    if (operationId && !operations.length) throw new DomainError('NOT_FOUND', 'Operation not found.', 404);
    if (operations.some(op => userId !== 'kasia' && op.buyerId !== userId)) throw new DomainError('FORBIDDEN', 'You can check only your own operations.', 403);
    for (const operation of operations) await this.reconcileOperation(operation.id);
    await this.compensateInvalidPlans();
    for (const plan of this.snapshot().plans) {
      if (plan.status === 'failed') await this.compensatePlan(plan.id);
      if (['capturing', 'reconciling'].includes(plan.status)) await this.continueCaptures(plan.id);
    }
  }
  async retryCompensation(userId: UserId, operationId: string) {
    this.organizer(userId);
    const operation = this.mutate(state => {
      const failed = state.operations[operationId];
      if (!failed || !['void', 'refund'].includes(failed.kind) || failed.status !== 'FAILED')
        throw new DomainError('RETRY_NOT_ALLOWED', 'A retry requires a confirmed refund or void failure. An unknown result must be checked first.', 409);
      const plan = state.plans.find(p => p.id === failed.planId)!;
      if (!['failed', 'invalidated'].includes(plan.status)) throw new DomainError('RETRY_NOT_ALLOWED', 'The purchase is not in the payment reversal stage.', 409);
      const payment = this.payment(state, plan, failed.buyerId);
      const current = failed.kind === 'refund' ? payment.refund : payment.void;
      if (current?.id !== failed.id) throw new DomainError('STALE_OPERATION', 'This operation has already been replaced by a newer attempt.', 409);
      return this.prepareOperation(state, plan, failed.buyerId, failed.kind, failed.parentProviderId);
    });
    await this.dispatch(operation);
    return { operationId: operation.id };
  }
  /** Explicit buyer action only: read PayPal first, then reuse the original saved command if needed. */
  async retryAuthorization(userId: UserId, operationId: string) {
    const buyerId = this.buyer(userId);
    const operation = this.mutate(state => {
      const failed = state.operations[operationId];
      if (!failed || failed.kind !== 'authorize' || failed.buyerId !== buyerId || failed.status !== 'FAILED')
        throw new DomainError('RETRY_NOT_ALLOWED', 'Choose your existing failed authorization. An unknown result must be checked first.', 409);
      const plan = this.requireCurrent(state, failed.planId); const payment = this.payment(state, plan, buyerId);
      if (payment.authorization?.id !== failed.id || !payment.order?.providerId || failed.parentProviderId !== payment.order.providerId)
        throw new DomainError('STALE_OPERATION', 'This authorization no longer belongs to your current order.', 409);
      this.requireGate(this.gates(state, buyerId).authorize);
      const saved = state.paymentCommands?.[failed.id]?.command;
      if (!saved || saved.kind !== 'authorize' || saved.providerId !== failed.parentProviderId || saved.idempotencyKey !== failed.idempotencyKey)
        throw new DomainError('RETRY_NOT_ALLOWED', 'The original authorization command is unavailable. Manual reconciliation is required.', 409);
      failed.status = 'UNKNOWN'; failed.checkNeeded = true; failed.updatedAt = this.time();
      failed.lastError = 'We are checking the existing PayPal authorization before retrying its saved command.';
      return clone(failed);
    });
    await this.reconcileOperation(operation.id);
    await this.compensateInvalidPlans();
    return { operationId: operation.id };
  }
  private async reconcileOperation(operationId: string) {
    const state = this.snapshot(); const operation = state.operations[operationId]; if (!operation || isFinal(operation)) return;
    this.mutate(s => { s.operations[operationId].reconcileAttempts++; s.operations[operationId].updatedAt = this.time(); });
    try {
      let result: ProviderResult;
      if (this.options.mode === 'rehearsal') result = this.rehearsalResult(operation, true);
      else {
        const provider = this.options.paymentProvider; if (!provider) return;
        const plan = state.plans.find(p => p.id === operation.planId)!; const payment = this.payment(state, plan, operation.buyerId);
        if (operation.kind === 'order') {
          if (!operation.providerId) { await this.dispatch(operation, true); return; }
          result = await provider.getOrder(operation.providerId);
        } else if (operation.kind === 'authorize') {
          if (operation.providerId) result = await provider.getAuthorization(operation.providerId);
          else if (operation.parentProviderId) {
            const order = await provider.getOrder(operation.parentProviderId);
            if (order.amountCents !== operation.amountCents || order.currency !== operation.currency)
              throw new PayPalProviderError('PAYPAL_AMOUNT_MISMATCH', 'The existing order does not match the saved authorization amount.', true);
            if (!order.authorizationId) { await this.dispatch(operation, true); return; }
            result = await provider.getAuthorization(order.authorizationId);
          } else { await this.dispatch(operation, true); return; }
        } else if (operation.kind === 'capture') {
          if (operation.providerId) result = await provider.getCapture(operation.providerId);
          else if (payment.order?.providerId) {
            const order = await provider.getOrder(payment.order.providerId);
            if (!order.captureId) { await this.dispatch(operation, true); return; }
            result = await provider.getCapture(order.captureId);
          } else { await this.dispatch(operation, true); return; }
        } else if (operation.kind === 'void') {
          if (!operation.parentProviderId) return;
          result = await provider.getAuthorization(operation.parentProviderId);
          if (result.status === 'AUTHORIZED' && !operation.providerId) { await this.dispatch(operation, true); return; }
          if (result.status !== 'VOIDED') result = { ...result, status: result.status === 'AUTHORIZED' ? 'PENDING' : 'UNKNOWN' };
        } else {
          if (!operation.providerId) { await this.dispatch(operation, true); return; }
          result = await provider.getRefund(operation.providerId);
        }
      }
      this.applyResult(operationId, result);
    } catch (error) {
      this.mutate(s => { const op = s.operations[operationId]; if (!isFinal(op)) { op.status = 'UNKNOWN'; op.checkNeeded = true; op.lastError = 'We are still checking the result of the existing operation.'; op.providerError = providerErrorInfo(error); } });
    }
  }
  /** Called only after the route verifies the PayPal signature. A duplicate event has no new effect. */
  async verifiedWebhook(event: unknown) {
    if (this.options.mode !== 'sandbox') throw new DomainError('SANDBOX_ONLY', 'PayPal webhooks are supported only in sandbox mode.', 409);
    const data = event as { id?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { authorization_id?: string; order_id?: string; capture_id?: string } } } };
    if (!data?.id || typeof data.id !== 'string') throw new DomainError('INVALID_WEBHOOK', 'Invalid event.');
    const match = this.mutate(state => {
      if (state.webhookEventIds.includes(data.id!)) return [];
      state.webhookEventIds.push(data.id!);
      const related = data.resource?.supplementary_data?.related_ids;
      const matches = Object.values(state.operations).filter(op => op.providerId === data.resource?.id ||
        (op.kind === 'capture' && !!related?.authorization_id && op.parentProviderId === related.authorization_id) ||
        (op.kind === 'authorize' && !!related?.order_id && op.parentProviderId === related.order_id) ||
        (op.kind === 'refund' && !!related?.capture_id && op.parentProviderId === related.capture_id));
      for (const op of matches) if (!op.providerId && data.resource?.id) op.providerId = data.resource.id;
      return matches.map(op => op.id);
    });
    for (const id of match) await this.reconcileOperation(id);
    for (const plan of this.snapshot().plans) {
      if (['capturing', 'reconciling'].includes(plan.status)) await this.continueCaptures(plan.id);
      if (['failed', 'invalidated'].includes(plan.status)) await this.compensatePlan(plan.id);
    }
  }
  updatePacking(userId: UserId, buyerId: BuyerId, input: Record<string, unknown>) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).packing); const parcel = state.packing.find(p => p.buyerId === buyerId);
      if (!parcel) throw new DomainError('NOT_FOUND', 'Parcel not found.', 404);
      if (input.checkedItemIds !== undefined) {
        const ids = this.validIds(state, input.checkedItemIds, 'checkedItemIds');
        if (ids.some(id => !parcel.itemIds.includes(id))) throw new DomainError('WRONG_PARCEL', 'This item belongs to a different parcel.');
        parcel.checkedItemIds = ids;
      }
      if (input.packed === true) { if (parcel.checkedItemIds.length !== state.collection.itemsPerBuyer) throw new DomainError('PACKING_INCOMPLETE', 'Check all six items in the parcel.'); parcel.packedAt ??= this.time(); }
      if (input.shipped === true) { if (!parcel.packedAt) throw new DomainError('NOT_PACKED', 'Confirm that the parcel has actually been packed first.'); parcel.shippedAt ??= this.time(); }
    });
  }
  setRehearsalOutcome(userId: UserId, outcome: unknown) {
    this.organizer(userId); this.mutate(state => {
      if (state.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Scenarios are available only in the demo rehearsal.', 403);
      if (!['success', 'unknown-ola', 'failure-ola'].includes(outcome as string)) throw new DomainError('INVALID_OUTCOME', 'Invalid scenario.');
      if (this.captureStarted(state)) throw new DomainError('PAYMENTS_STARTED', 'Choose a scenario before starting payment captures.', 409);
      state.rehearsalCaptureOutcome = outcome as DomainState['rehearsalCaptureOutcome'];
    });
  }
  private resetRehearsal(state: DomainState, collectionId: DemoCollectionId) {
    if (state.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Examples are available only in the demo rehearsal.', 403);
    const fresh = createInitialState('rehearsal', this.now(), collectionId);
    // Object.assign alone leaves optional values from the previous snapshot behind.
    delete state.currentPlanId; delete state.noSolution;
    Object.assign(state, fresh, { revision: state.revision });
  }
  setRehearsalCollection(userId: UserId, collectionId: unknown) {
    this.organizer(userId);
    if (this.options.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Examples are available only in the demo rehearsal.', 403);
    if (!isDemoCollectionId(collectionId)) throw new DomainError('INVALID_DEMO_COLLECTION', 'Choose an available example collection.', 400, { collectionId: 'Invalid example collection.' });
    this.mutate(state => this.resetRehearsal(state, collectionId));
  }
  async setScenario(userId: UserId, scenario: RehearsalScenario) {
    this.organizer(userId);
    if (this.options.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Scenarios are available only in the demo rehearsal.', 403);
    const scenarios: RehearsalScenario[] = ['start', 'collecting', 'plan', 'agreements', 'three-authorizations', 'ready', 'success', 'unknown', 'partial-failure', 'refund-completed', 'dropout', 'v2'];
    if (!scenarios.includes(scenario)) throw new DomainError('INVALID_SCENARIO', 'Invalid scenario.');
    const collectionId = this.snapshot().rehearsalCollectionId ?? 'illustrations';
    this.mutate(state => this.resetRehearsal(state, collectionId));
    if (scenario === 'start') return;
    this.mutate(state => { for (const item of state.collection.items) item.confirmed = true; });
    this.confirmCatalog('kasia');
    for (const id of ['maja', 'ola', 'bartek', 'jan'] as BuyerId[]) {
      const defaults = getDemoDefaults(collectionId, id);
      this.savePreferences(id, defaults); this.saveAlternatives(id, { alternativeItemIds: defaults.alternativeItemIds, confirmed: true });
    }
    if (scenario === 'collecting') return;
    this.solve('kasia'); let plan = this.current(this.snapshot())!;
    if (scenario === 'plan') return;
    this.sendPlan('kasia', plan.id);
    for (const assignment of plan.assignments) this.agree(assignment.buyerId, plan.id, assignment.termsDigest);
    if (scenario === 'agreements') return;
    if (scenario === 'dropout' || scenario === 'v2') {
      await this.withdraw('jan');
      if (scenario === 'dropout') return;
      await this.replace('kasia', 'jan', 'ewa');
      const defaults = getDemoDefaults(collectionId, 'ewa');
      this.savePreferences('ewa', defaults); this.saveAlternatives('ewa', { alternativeItemIds: defaults.alternativeItemIds, confirmed: true }); this.solve('kasia'); return;
    }
    const authorized = scenario === 'three-authorizations' ? ['maja', 'ola', 'bartek'] as BuyerId[] : ['maja', 'ola', 'bartek', 'jan'] as BuyerId[];
    for (const id of authorized) {
      this.saveAddress(id, { recipient: userForId(id).name, street: 'Przykładowa 12/4', postalCode: '00-001', city: 'Warszawa', country: 'Polska' });
      const order = await this.authorize(id, plan.id); await this.approve(id, order.operationId);
    }
    if (scenario === 'three-authorizations' || scenario === 'ready') return;
    if (scenario === 'unknown') this.setRehearsalOutcome('kasia', 'unknown-ola');
    if (scenario === 'partial-failure' || scenario === 'refund-completed') this.setRehearsalOutcome('kasia', 'failure-ola');
    await this.capture('kasia', plan.id);
    if (scenario === 'refund-completed') await this.reconcile('kasia');
  }
}

function safeImage(value: string) {
  return /^\/(?!\/)[^\s]*$/.test(value) || /^https:\/\//.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}
