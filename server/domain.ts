import { createHash, randomUUID } from 'node:crypto';
import type {
  AllocationPlan, AppMode, AppView, Assignment, BuyerId, BuyerPayment, Collection, CollectionItem, OrganizerView,
  Consent, DeliveryAddress, Gates, NoSolution, OperationKind, OperationStatus, PackingPackage,
  Participant, PaymentOperation, PaymentView, Preferences, PriorPlanPaymentBlocker, RehearsalScenario, UserId, CheckedQuestion,ImageRegion,
} from '../shared/types.js';
import { createCollection, createParticipants, DEMO_ACCESS, getDemoDefaults, sourceForMode, userForId } from './seed.js';
import { DEFAULT_DEMO_COLLECTION_ID, isDemoCollectionId, type DemoCollectionId } from '../shared/demo-collections.js';
import { PayPalProviderError, type CreateOrderInput, type PaymentProvider, type ProviderResult } from './paypal.js';
import { SqliteStore } from './store.js';
import { createV2Collection, v2Participants, v2Defaults, v2User, V2_ACCESS, V2_BUYERS } from './v2-catalog.js';
import { agentContextDigest, solveWholeBaskets, V2_CONTRACT, wholeBasketDigest } from './v2-rules.js';
import { V2_EXAMPLES } from '../shared/v2-examples.js';

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
  /** Only the response to this frozen refund command can identify its provider refund. */
  refundResponseId?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
}
/** Provider resource lifecycles may change after an immutable command has succeeded. */
interface PaymentResourceObservation {
  providerId: string;
  status: OperationStatus;
  checkNeeded: boolean;
  updatedAt: string;
  adverseEventType?: string;
  rawStatus?: string;
  expiresAt?: string;
  lastError?: string;
  refundChecks?: { providerId: string; status?: ProviderResult['status'] }[];
  refundChecksOverflow?: boolean;
  generation?: number;
  holdCheckedForCapture?: string;
  /** First unowned child reported against this saved parent. Never a local capture receipt. */
  unattributedCapture?: { resourceId: string; eventType: string };
}
type PendingResourceChange = ({ captureId: string } | { resourceId: string }) & { eventType: string; refundId?: string; ownerOperationId?: string };
interface PendingChanges { changes: PendingResourceChange[]; overflow?: boolean }
const MAX_RESOURCE_CHANGE_HINTS = 16;
const changeId = (change: PendingResourceChange) => 'captureId' in change ? change.captureId : change.resourceId;
const awaitingResourceId = 'A verified payment change is awaiting the original resource ID. No payment command will be repeated.';
const manualCaptureReview = 'PayPal reported capture activity on this payment outside a confirmed LOTSPLIT command. Collection and preparation are paused for manual review.';
// PayPal documents Orders keys for 6h and Payments capture/void/refund keys for 45 days:
// https://developer.paypal.com/sdk/orders/v2/orders-create/
// https://github.com/paypal/PayPal-PHP-Server-SDK/blob/main/doc/controllers/payments.md
// Five hours is our conservative common policy, not a claim of unlimited provider retention.
// Age is always measured from the original persisted operation, never a retry or server restart.
const SAFE_REPLAY_WINDOW_MS = 5 * 60 * 60 * 1000;
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
export interface DomainState {
  paymentDeadline?: string;
  agentQuestion?: CheckedQuestion;
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
  paymentObservations?: Record<string, PaymentResourceObservation>;
  pendingCaptureChanges?: Record<string, PendingChanges>; // Keep the existing persisted capture hints readable.
  pendingResourceChanges?: Record<string, PendingChanges>;
  packing: PackingPackage[];
  webhookEventIds: string[];
  invitationTokens: Partial<Record<UserId, string>>;
  rehearsalCaptureOutcome: 'success' | 'unknown-ola' | 'failure-ola';
}
export interface EngineOptions {
  conceptVersion?: 2;
  recipientId?: string;
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
const consentValid = (plan: AllocationPlan, assignment: Assignment) => plan.consents[assignment.buyerId]?.termsDigest === assignment.termsDigest && (plan.contractVersion!==2 || plan.consents[assignment.buyerId]?.contract==='own-basket-group-v2');
const sorted = (ids: string[]) => [...ids].sort();
function imageRegion(value:unknown):ImageRegion|undefined {
  if(value===undefined||value===null)return undefined;
  const r=value as ImageRegion;
  if(!r||typeof r!=='object'||![r.x,r.y,r.width,r.height].every(n=>typeof n==='number'&&Number.isFinite(n))||r.x<0||r.y<0||r.x>=1||r.y>=1||r.width<=0||r.height<=0||r.x+r.width>1.000001||r.y+r.height>1.000001)throw new DomainError('INVALID_IMAGE_REGION','The item crop does not fit the photo. Choose a separate item photo.');
  return {x:r.x,y:r.y,width:Math.min(r.width,1-r.x),height:Math.min(r.height,1-r.y)};
}
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
  if (collection.protocolVersion === 2) return wholeBasketDigest(collection, buyerId, itemIds, totalCents);
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
  if (collection.protocolVersion === 2) return solveWholeBaskets(collection, participants);
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
  // Candidate enumeration can retain over half a million combinations. Keep only
  // numeric facts here; materialize item arrays for the four final assignments.
  type Candidate = { mask: number; base: number; alternativeCount: number };
  const completeMask = (1 << collection.items.length) - 1;
  const entries = collection.items.map((item, index) => ({ ...item, bit: 1 << index }));
  const orderedEntries = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const accepted = buyers.map(buyer => new Set([...buyer.preferences!.preferredItemIds, ...buyer.preferences!.alternativeItemIds]));
  const preferredSets = buyers.map(buyer => new Set(buyer.preferences!.preferredItemIds));
  const bitCount = (value: number) => { let count = 0; for (; value; value &= value - 1) count++; return count; };
  // Every subset of buyers needs enough distinct acceptable items for all its places.
  const canCover = (masks: number[]) => {
    for (let subset = 1; subset < 1 << masks.length; subset++) {
      let union = 0; let count = 0;
      for (let index = 0; index < masks.length; index++) if (subset & (1 << index)) { union |= masks[index]; count++; }
      if (bitCount(union) < count * collection.itemsPerBuyer) return false;
    }
    return true;
  };
  const noAllocation = () => no('NO_ALLOCATION', 'No complete split of acceptable items fits the saved budgets.');
  if (!canCover(accepted.map(ids => entries.reduce((mask, item) => ids.has(item.id) ? mask | item.bit : mask, 0)))) return noAllocation();
  const assignments = (allocation: Candidate[]): Assignment[] => buyers.map((buyer, index) => {
    const candidate = allocation[index]; const totalCents = candidate.base + cost;
    const itemIds = orderedEntries.filter(item => candidate.mask & item.bit).map(item => item.id);
    return { buyerId: buyer.id, itemIds, baseCents: candidate.base, sharedCostCents: cost,
      totalCents, alternativeItemIds: itemIds.filter(id => !preferredSets[index].has(id)), termsDigest: termsDigest(collection, buyer.id, itemIds, totalCents) };
  });
  const preferredOnly = buyers.map((_, index) => {
    const items = entries.filter(item => preferredSets[index].has(item.id));
    return { mask: items.reduce((mask, item) => mask | item.bit, 0), base: items.reduce((sum, item) => sum + item.shareCents, 0), alternativeCount: 0 };
  });
  if (preferredOnly.every((candidate, index) => bitCount(candidate.mask) === collection.itemsPerBuyer && candidate.base + cost <= buyers[index].preferences!.budgetCents) &&
    preferredOnly.reduce((mask, candidate) => mask | candidate.mask, 0) === completeMask) return assignments(preferredOnly);
  // A limit means "not proved within this request", never "no allocation exists".
  // Keep this synchronous search below one second rather than blocking every API request.
  const deadline = performance.now() + 750;
  let work = 0;
  const checkWork = () => {
    if (++work > 2_000_000 || (work % 512 === 0 && performance.now() >= deadline))
      throw new DomainError('SOLVER_LIMIT', 'This split needs more searching than this demo can safely perform. Narrow the accepted alternatives or adjust budgets, then calculate again. No new plan was created.', 409);
  };
  const candidates = buyers.map((buyer, buyerIndex) => {
    const prefs = buyer.preferences!;
    const preferred = preferredSets[buyerIndex];
    const available = orderedEntries.filter(item => accepted[buyerIndex].has(item.id));
    const groups: Candidate[][] = Array.from({ length: collection.itemsPerBuyer + 1 }, () => []);
    function choose(start: number, count: number, mask: number, base: number, alternativeCount: number) {
      checkWork();
      if (base + cost > prefs.budgetCents) return;
      if (count === collection.itemsPerBuyer) { groups[alternativeCount].push({ mask, base, alternativeCount }); return; }
      const needed = collection.itemsPerBuyer - count;
      for (let index = start; index <= available.length - needed; index++) {
        const item = available[index];
        choose(index + 1, count + 1, mask | item.bit, base + item.shareCents, alternativeCount + Number(!preferred.has(item.id)));
      }
    }
    choose(0, 0, 0, 0, 0);
    return groups.flat();
  });
  const candidateMasks = candidates.map(list => list.reduce((mask, candidate) => mask | candidate.mask, 0));
  if (candidates.some(c => !c.length) || !canCover(candidateMasks)) return noAllocation();
  const order = buyers.map((_, i) => i).sort((a, b) => candidates[a].length - candidates[b].length || a - b);
  const remainingCoverage = order.map((_, depth) => order.slice(depth).reduce((mask, index) => mask | candidateMasks[index], 0));
  const searched = buyers.map(() => new Map<number, number>());
  const preferredByAnyone = new Set(buyers.flatMap(p => p.preferences!.preferredItemIds));
  const lowerBound = collection.items.filter(item => !preferredByAnyone.has(item.id)).length;
  let best: Candidate[] | undefined;
  let bestAlternatives = Infinity;
  const chosen: Candidate[] = [];
  function search(depth: number, mask: number, altCount: number): boolean {
    checkWork();
    if (altCount >= bestAlternatives) return false;
    if (depth === order.length) {
      if (mask !== completeMask) return false;
      best = [...chosen]; bestAlternatives = altCount;
      return bestAlternatives === lowerBound;
    }
    if ((mask | remainingCoverage[depth]) !== completeMask || (searched[depth].get(mask) ?? Infinity) <= altCount) return false;
    searched[depth].set(mask, altCount);
    const index = order[depth];
    for (const candidate of candidates[index]) {
      checkWork();
      if (candidate.mask & mask || altCount + candidate.alternativeCount >= bestAlternatives) continue;
      chosen[index] = candidate;
      if (search(depth + 1, mask | candidate.mask, altCount + candidate.alternativeCount)) return true;
    }
    return false;
  }
  search(0, 0, 0);
  return best ? assignments(best) : noAllocation();
}

export class LotSplitEngine {
  private readonly now: () => Date;
  private readonly baseUrl: string;
  constructor(readonly store: SqliteStore<DomainState>, readonly options: EngineOptions) {
    this.now = options.now ?? (() => new Date()); this.baseUrl = options.baseUrl ?? 'http://localhost:5173';
    const initial = options.conceptVersion === 2 ? this.freshV2(options.mode) : createInitialState(options.mode, this.now());
    const state = store.initialize(initial);
    if (state.mode !== options.mode) throw new Error('Stored mode differs from configured mode. Use a separate LOTSPLIT_DB for each mode.');
    if (options.conceptVersion === 2 && state.collection.protocolVersion !== 2) throw new Error('V2 requires its own database. Historical payment stores are not migrated automatically.');
    if(options.conceptVersion===2 && options.recipientId && state.collection.seller?.recipientId!==options.recipientId) throw new Error('Configured merchant identity differs from the stored V2 recipient. Reuse the intended Sandbox application or start a separate workspace.');
  }
  private freshV2(mode: AppMode, collectionId: DemoCollectionId = 'workshop'): DomainState {
    const collection = createV2Collection(this.now(), collectionId, this.options.recipientId);
    return { schemaVersion:1, revision:0, mode, ...(mode==='rehearsal'?{rehearsalCollectionId:collectionId}:{}), collection,
      participants:v2Participants(collection.buyerCount), plans:[], operations:{}, paymentCommands:{}, packing:[], webhookEventIds:[], invitationTokens:{}, rehearsalCaptureOutcome:'success' };
  }
  sessionUser(id: UserId) { const state=this.snapshot(); return state.collection.protocolVersion===2 ? v2User(id,state.participants) : userForId(id); }
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
  private pendingChanges(state: DomainState, id: string) { return state.pendingCaptureChanges?.[id] ?? state.pendingResourceChanges?.[id]; }
  private observedOp(state: DomainState, id: string | undefined) {
    const operation = this.op(state, id); const observation = id ? state.paymentObservations?.[id] : undefined;
    if (operation && this.pendingChanges(state, operation.id)) return { ...operation, status: 'UNKNOWN' as const, checkNeeded: true, providerChange: true, lastError: awaitingResourceId };
    return operation && observation ? { ...operation, status: observation.status, checkNeeded: observation.checkNeeded,
      updatedAt: observation.updatedAt, lastError: observation.lastError, expiresAt: observation.expiresAt ?? operation.expiresAt,
      ...(observation.unattributedCapture || observation.adverseEventType || observation.status !== operation.status ? { providerChange: true } : {}) } : operation;
  }
  private payment(state: DomainState, plan: AllocationPlan, buyerId: BuyerId): PaymentView {
    const p = plan.payments[buyerId] ?? {};
    return { order: this.observedOp(state, p.orderOperationId), authorization: this.observedOp(state, p.authorizationOperationId), capture: this.observedOp(state, p.captureOperationId), void: this.op(state, p.voidOperationId), refund: this.observedOp(state, p.refundOperationId) };
  }
  private needsCaptureReview(state: DomainState, plan: AllocationPlan) {
    return Object.values(plan.payments).some(p => [p?.orderOperationId, p?.authorizationOperationId]
      .some(id => id && state.paymentObservations?.[id]?.unattributedCapture));
  }
  private expired(state: DomainState) { return Math.min(Date.parse(state.collection.reservationExpiresAt), state.paymentDeadline ? Date.parse(state.paymentDeadline) : Infinity) <= this.now().getTime(); }
  private captureStarted(state: DomainState) { return Object.values(state.operations).some(op => op.kind === 'capture'); }
  private captureFullyRefunded(state: DomainState, capture: PaymentOperation | undefined) {
    const observation = capture ? state.paymentObservations?.[capture.id] : undefined;
    return !!observation && !observation.checkNeeded && observation.rawStatus === 'REFUNDED';
  }
  /** A completed or fully refunded final capture accounts for its spent hold. A decline does not. */
  private unsettledPayments(state: DomainState, payment: PaymentView) {
    const { order, authorization, capture, refund, void: cancellation } = payment;
    const operations = new Map<string, PaymentOperation>();
    const add = (op: PaymentOperation | undefined) => { if (op) operations.set(op.id, op); };
    if (authorization && state.paymentObservations?.[authorization.id]?.unattributedCapture) add(authorization);
    for (const op of [order, capture, refund, cancellation]) if (isUnknown(op)) add(op);
    if (capture?.status === 'COMPLETED') {
      if (refund?.status !== 'COMPLETED') add(refund ?? capture);
    } else if (!this.captureFullyRefunded(state, capture) && cancellation?.status !== 'VOIDED') {
      if (isUnknown(authorization)) add(authorization);
      else if (authorization?.status === 'AUTHORIZED') add(cancellation ?? authorization);
    }
    if (order && ['CREATED', 'APPROVED'].includes(order.status) && !authorization) add(order);
    return [...operations.values()];
  }
  private editingAllowed(state: DomainState) {
    return !state.plans.some(plan => {
      if (this.needsCaptureReview(state, plan)) return true;
      const payments = plan.assignments.map(a => this.payment(state, plan, a.buyerId));
      if (!payments.some(payment => payment.capture)) return false;
      if (['capturing', 'reconciling', 'paid'].includes(plan.status)) return true;
      return payments.some(payment => this.unsettledPayments(state, payment).length > 0);
    });
  }
  private allAgreements(plan: AllocationPlan | undefined) { return !!plan && (plan.contractVersion===2?plan.assignments.length>=2:plan.assignments.length===4) && plan.assignments.every(a => consentValid(plan, a)); }
  private authorizationReady(state: DomainState, plan: AllocationPlan, assignment: Assignment) {
    const payment = this.payment(state, plan, assignment.buyerId); const auth = payment.authorization;
    return auth?.status === 'AUTHORIZED' && !auth.checkNeeded && (state.collection.protocolVersion===2 ? auth.termsDigest===assignment.termsDigest && plan.consents[assignment.buyerId]?.contract===V2_CONTRACT : auth.planId===plan.id) && auth.buyerId === assignment.buyerId &&
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
  private priorPaymentBlockers(state: DomainState, currentId: string): PriorPlanPaymentBlocker[] {
    const current=state.plans.find(p=>p.id===currentId);
    const retained=new Set(current ? Object.values(current.payments).flatMap(p=>Object.values(p ?? {})) : []);
    return state.plans.filter(p => p.id !== currentId).flatMap(plan => plan.assignments.flatMap(a => {
      const payment = this.payment(state, plan, a.buyerId);
      const operations = this.unsettledPayments(state, payment).filter(op => !retained.has(op.id));
      return operations.length ? [{ planId: plan.id, planVersion: plan.version, buyerId: a.buyerId,
        buyerName: this.participant(state, a.buyerId).name, operations }] : [];
    }));
  }
  private priorPaymentBlocked(state: DomainState, currentId: string) { return this.priorPaymentBlockers(state, currentId).length > 0; }
  private gates(state: DomainState, buyerId?: BuyerId): Gates {
    const collection = state.collection; const plan = this.current(state); const valid = plan && plan.status !== 'invalidated';
    const active = state.participants.filter(p => p.active); const allAgreed = this.allAgreements(plan);
    const editable = this.editingAllowed(state); const reservationOk = !this.expired(state);
    const previousBlocked = !!plan && this.priorPaymentBlocked(state, plan.id);
    const review = !!plan && this.needsCaptureReview(state, plan);
    const paymentReady = this.options.mode === 'rehearsal' || !!this.options.paymentProvider;
    const readyAuthorizations = !!plan && this.currentCaptureTerms(state, plan) && plan.assignments.every(a => this.authorizationReady(state, plan, a));
    let authorize = !valid || !allAgreed ? denied('Waiting for all valid agreements to the current plan.')
      : review ? denied(manualCaptureReview) : !reservationOk ? denied('The collection reservation has expired.') : previousBlocked ? denied('Payments for the previous version must be resolved first.')
      : !paymentReady ? denied('PayPal sandbox is not configured.') : !['sent'].includes(plan.status) ? denied('Payments for this plan are being settled.') : allowed();
    if (buyerId) {
      const participant = this.participant(state, buyerId); const own = plan?.assignments.find(a => a.buyerId === buyerId);
      const payment = plan ? this.payment(state, plan, buyerId) : {};
      if (!participant.active || !own) authorize = denied('You are not an active participant in the current plan.');
      else if (collection.protocolVersion!==2 && !participant.address) authorize = denied('Add your delivery address.');
      else if (isUnknown(payment.order) || isUnknown(payment.authorization)) authorize = denied('We are checking the result of the existing operation.');
      else if (payment.authorization?.status === 'AUTHORIZED') authorize = denied('Authorization is ready. No payment has been captured.');
    }
    return {
      confirmCatalog: editable ? allowed() : denied('Payments are being settled.'),
      solve: collection.catalogStatus !== 'confirmed' ? denied('Confirm the catalogue and fixed prices first.') : !editable ? denied('Payments are being settled.') : collection.protocolVersion===2 && !reservationOk ? denied('The reservation has ended.') : allowed(),
      sendPlan: !valid || plan.status !== 'draft' ? denied('Calculate a current, complete plan first.') : allowed(),
      agree: collection.protocolVersion===2 && !reservationOk ? denied('The reservation has ended.') : !valid || !['sent'].includes(plan.status) ? denied('Waiting for the current plan to be sent.')
        : buyerId && !plan.assignments.some(a => a.buyerId === buyerId) ? denied('You are not a participant in this version.') : allowed(),
      authorize,
      capture: review ? denied(manualCaptureReview) : !valid || plan.status !== 'sent' ? denied('The plan is not ready for payment capture.') : !reservationOk ? denied('The collection reservation has expired.')
        : !allAgreed ? denied('Waiting for all valid agreements.') : previousBlocked ? denied('Previous operations need to be resolved.')
        : !readyAuthorizations ? denied('Waiting for all valid authorizations for the exact amounts.') : !paymentReady ? denied('PayPal sandbox is not configured.') : allowed(),
      packing: !review && valid && plan.status === 'paid' && plan.assignments.length === active.length && plan.assignments.every(a => {
        const payment = this.payment(state, plan, a.buyerId); return payment.capture?.status === 'COMPLETED' && !payment.refund;
      }) ? allowed() : denied('Preparation requires all confirmed COMPLETED captures for one valid plan.'),
      editPreferences: editable && collection.catalogStatus === 'confirmed' ? allowed() : denied(editable ? 'The catalog has not been confirmed yet.' : 'Payments are being settled.'),
      withdraw: editable ? allowed() : denied('Payment capture has started. Payments must be resolved first.'),
    };
  }
  private requireGate(gate: { allowed: boolean; reason?: string }, code = 'GATE_CLOSED') { if (!gate.allowed) throw new DomainError(code, gate.reason ?? 'This action is currently unavailable.', 409); }

  view(userId?: UserId): AppView {
    const state = this.snapshot();
    // A missing discriminator belongs to a historical illustration demo; do not migrate stored data on reads.
    const rehearsalCollectionId = state.mode === 'rehearsal' ? state.rehearsalCollectionId ?? 'illustrations' : undefined;
    const v2=state.collection.protocolVersion===2;
    const demoAccess=v2?V2_ACCESS.map(access=>({...access,name:access.role==='organizer'?state.collection.seller?.name??access.name:state.participants.find(p=>`demo-${p.id}`===access.inviteToken)?.name??access.name})):DEMO_ACCESS;
    if (!userId) return { ...(v2?{conceptVersion:2 as const}:{}), authenticated: false, mode: this.options.mode, rehearsalCollectionId, demoAccess: this.options.mode === 'rehearsal' ? clone(demoAccess) : [], paymentConfigured: !!this.options.paymentProvider, aiConfigured: !!this.options.aiConfigured };
    const plan = this.current(state); const isOrganizer = userId === 'kasia';
    const gates = this.gates(state, isOrganizer ? undefined : userId);
    const progress = { activeBuyers: state.participants.filter(p => p.active).length, requiredBuyers: state.collection.buyerCount,
      preferences: state.participants.filter(p => p.active && p.preferences?.submittedAt).length,
      agreements: plan?.status === 'invalidated' ? 0 : plan?.assignments.filter(a => consentValid(plan, a)).length ?? 0,
      authorizations: plan?.status === 'invalidated' ? 0 : plan?.assignments.filter(a => {
        const payment = this.payment(state, plan, a.buyerId);
        return payment.authorization?.status === 'AUTHORIZED' && !payment.void && !(payment.order && state.paymentObservations?.[payment.order.id]?.unattributedCapture);
      }).length ?? 0,
      captures: plan?.assignments.filter(a => this.payment(state, plan, a.buyerId).capture?.status === 'COMPLETED').length ?? 0 };
    const base = { ...(v2?{conceptVersion:2 as const,paymentDeadline:state.paymentDeadline, demoAccess:state.mode==='rehearsal'?clone(demoAccess):[]}:{}), authenticated: true as const, mode: state.mode, rehearsalCollectionId, me: this.sessionUser(userId), revision: state.revision, progress, gates,
      reservationExpired: this.expired(state), paymentConfigured: !!this.options.paymentProvider, aiConfigured: !!this.options.aiConfigured,
      simulationNotice: state.mode === 'rehearsal' ? 'Payment rehearsal. Payments are simulated; there is no connection to PayPal.' : undefined };
    const previousFor = (buyerId: BuyerId) => {
      const older = state.plans.filter(p => p.version < (plan?.version ?? 0)).reverse().find(p => p.assignments.some(a => a.buyerId === buyerId));
      const assignment = older?.assignments.find(a => a.buyerId === buyerId);
      return assignment ? { itemIds: assignment.itemIds, totalCents: assignment.totalCents,...(v2&&older?{payment:this.payment(state,older,buyerId)}:{}) } : undefined;
    };
    const oldPlan=state.plans.filter(p=>p.version<(plan?.version??0)).at(-1);
    let planCheck:OrganizerView['planCheck'];
    if(v2&&isOrganizer){
      if(!gates.solve.allowed)planCheck={status:'closed',unassignedItemIds:[]};
      else if(progress.preferences!==progress.activeBuyers)planCheck={status:'waiting',unassignedItemIds:[]};
      else if(state.noSolution?.code==='INCOMPLETE')planCheck={status:'incomplete',unassignedItemIds:[]};
      else {const checked=solveWholeBaskets(state.collection,state.participants,plan?.assignments);planCheck=Array.isArray(checked)?{status:'complete',unassignedItemIds:[]}:{status:'blocked',unassignedItemIds:checked.unassignedItemIds};}
    }
    if (isOrganizer) return clone({ ...base,...(v2?{planCheck}:{}), role: 'organizer', collection: state.collection,
      previousPlan:v2&&oldPlan?{id:oldPlan.id,version:oldPlan.version,buyers:oldPlan.assignments.map(a=>({buyerId:a.buyerId,name:this.participant(state,a.buyerId).name,amountCents:a.totalCents,payment:this.payment(state,oldPlan,a.buyerId)}))}:undefined,
      participants: state.participants.map(p => v2 ? { ...p, address:undefined, preferences:p.preferences ? { ...p.preferences, budgetCents:0,description:undefined } : undefined } : gates.packing.allowed ? p : { ...p, address: undefined }),
      plan: plan ? { id: plan.id, version: plan.version, status: plan.status, createdAt: plan.createdAt, sentAt: plan.sentAt,
        failureReason: plan.failureReason, invalidationReason: plan.invalidationReason,
        assignments: plan.assignments.map(a => ({ ...a, buyerName: this.participant(state, a.buyerId).name,
          budgetCents: v2?0:this.participant(state, a.buyerId).preferences?.budgetCents ?? 0, consent: plan.consents[a.buyerId],
          payment: this.payment(state, plan, a.buyerId), previous: previousFor(a.buyerId) })) } : undefined,
      noSolution: state.noSolution ? {...state.noSolution,...(v2?{limitsTotalCents:0,shortfallCents:0}:{})} : undefined, agentQuestion:v2 && state.agentQuestion?.contextDigest===agentContextDigest(state.collection,state.participants)?state.agentQuestion:undefined, invitations: state.participants.map(p => ({ buyerId: p.id, name: p.name,
        url: `/invite/${state.mode === 'rehearsal' ? `demo-${p.id}` : state.invitationTokens[p.id] ?? ''}`, active: p.active })),
      packing: gates.packing.allowed ? state.packing : [], priorPaymentBlockers: plan ? this.priorPaymentBlockers(state, plan.id) : [],
      rehearsalCaptureOutcome: state.rehearsalCaptureOutcome });
    const participant = this.participant(state, userId); const assignment = plan?.assignments.find(a => a.buyerId === userId);
    const { items, ...collection } = state.collection;
    const shipment = state.packing.find(p => p.buyerId === userId);
    return clone({ ...base, role: 'buyer', collection: { ...collection, items: items.map(({ shareCents: _share, ...item }) => ({...item,...(v2?{fixedPriceCents:_share}:{})})) },
      participant, plan: plan && assignment && plan.status !== 'draft' ? { id: plan.id, version: plan.version, status: plan.status,
        assignment, consent: plan.consents[userId], payment: this.payment(state, plan, userId), previous: previousFor(userId),
        failureReason: plan.failureReason, invalidationReason: plan.invalidationReason } : undefined,
      noSolution: state.noSolution ? { message: state.noSolution.message } : undefined,
      shipment: shipment ? { packedAt: shipment.packedAt, shippedAt: shipment.shippedAt } : undefined,
      agentQuestion:v2 && state.agentQuestion?.buyerId===userId && state.agentQuestion.status==='sent' && state.agentQuestion.contextDigest===agentContextDigest(state.collection,state.participants)?state.agentQuestion:undefined,
      demoDefaults: v2?v2Defaults(state.collection,userId):getDemoDefaults(rehearsalCollectionId, userId) });
  }

  updateCollection(userId: UserId, input: Record<string, unknown>) {
    this.organizer(userId); this.mutate(state => {
      if (!this.editingAllowed(state)) throw new DomainError('PAYMENTS_STARTED', 'Payments are being settled.', 409);
      const financial = input.collectionPriceCents !== undefined || input.sharedCostCents !== undefined;
      if (financial && state.collection.preferencesOpened) throw new DomainError('SHARES_LOCKED', 'Set costs and item shares before collecting budget limits.', 409);
      const c = state.collection;
      if(c.protocolVersion===2 && input.sharedCostCents!==undefined && input.sharedCostCents!==0) throw new DomainError('FIXED_PRICES','V2 uses fixed item prices and one pickup; no shared delivery charge.');
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
      if(c.protocolVersion===2 && input.pickup!==undefined) {
        const p=input.pickup as Record<string,unknown>;
        const next={location:textField(p?.location,'location',200),startsAt:textField(p?.startsAt,'startsAt',100),endsAt:textField(p?.endsAt,'endsAt',100)};
        if(!Number.isFinite(Date.parse(next.startsAt)) || !Number.isFinite(Date.parse(next.endsAt)) || Date.parse(next.startsAt)<=Date.parse(c.reservationExpiresAt) || Date.parse(next.endsAt)<=Date.parse(next.startsAt)) throw new DomainError('INVALID_PICKUP','Choose one pickup period after the reservation deadline.');
        if(JSON.stringify(c.pickup)!==JSON.stringify(next)){c.pickup=next;this.invalidate(state,'The pickup terms changed.');}
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
      if(input.imageRegion!==undefined)item.imageRegion=imageRegion(input.imageRegion);
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
      if ((c.protocolVersion===2 ? c.items.length<1 || c.items.length>24 : c.items.length!==24) || new Set(c.items.map(i => i.id)).size !== c.items.length || c.items.some(i => !i.confirmed || i.needsReview || !i.condition || !safeImage(i.imageUrl)))
        throw new DomainError('CATALOG_INCOMPLETE', 'Review and confirm every catalogue item.');
      if (c.items.some(i => !Number.isSafeInteger(i.shareCents) || i.shareCents < 0) || c.items.reduce((sum, i) => sum + i.shareCents, 0) !== c.collectionPriceCents)
        throw new DomainError('SHARE_SUM', 'The item shares must add up to the collection price.');
      if(c.protocolVersion===2&&c.items.some(i=>i.shareCents<=0))throw new DomainError('FIXED_PRICE_REQUIRED','Set a fixed price greater than zero for every item before opening the catalogue.');
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
    if (state.mode === 'rehearsal' && token.startsWith('demo-')) return (state.collection.protocolVersion===2?V2_ACCESS:DEMO_ACCESS).some(a => a.inviteToken === token) ? token.slice(5) as UserId : undefined;
    return (Object.entries(state.invitationTokens).find(([, t]) => t === token)?.[0]) as UserId | undefined;
  }
  savePreferences(userId: UserId, input: Record<string, unknown>) {
    if(this.snapshot().collection.protocolVersion===2) { this.saveBasketOptions(userId,input); return; }
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
  saveBasketOptions(userId: UserId, input: Record<string,unknown>) {
    const id=this.buyer(userId);
    this.mutate(state=>{
      if(state.collection.protocolVersion!==2) throw new DomainError('V2_REQUIRED','Whole basket options require V2.');
      this.requireGate(this.gates(state,id).editPreferences);
      if(this.expired(state)) throw new DomainError('EXPIRED','The reservation has ended.',409);
      const participant=this.participant(state,id);
      if(!participant.active) throw new DomainError('INACTIVE','This buyer is not active.',409);
      if(input.confirmed!==true) throw new DomainError('CONFIRM_OPTIONS','Review and explicitly confirm each complete basket.');
      const raw=input.basketOptions;
      if(!Array.isArray(raw) || raw.length<1 || raw.length>2) throw new DomainError('OPTION_COUNT','Save one or two complete acceptable baskets.');
      const budget=money(input.budgetCents,'budgetCents',false);
      const rejected=this.validIds(state,input.rejectedItemIds??participant.preferences?.rejectedItemIds??[],'rejectedItemIds');
      const options=raw.map((o,index)=>{
        const ids=this.validIds(state,Array.isArray(o)?o:(o as {itemIds?:unknown})?.itemIds,'basketOptions');
        if(!ids.length) throw new DomainError('EMPTY_BASKET','Each acceptable option must contain at least one item.');
        if(ids.some(id=>rejected.includes(id)))throw new DomainError('REJECTED_ITEM','A basket includes an item you explicitly rejected.');
        if(ids.reduce((sum,itemId)=>sum+state.collection.items.find(i=>i.id===itemId)!.shareCents,0)>budget) throw new DomainError('BUDGET_LIMIT','Every saved whole basket must fit your private limit.');
        return {id:`option-${index+1}`,itemIds:ids,confirmedAt:this.time()};
      });
      if(new Set(options.map(o=>o.itemIds.join(','))).size!==options.length) throw new DomainError('DUPLICATE_OPTION','These baskets are identical. Save the option once.');
      participant.preferences={preferredItemIds:options[0].itemIds,alternativeItemIds:[],alternativesConfirmed:true,budgetCents:budget,
        basketOptions:options,rejectedItemIds:rejected,description:typeof input.description==='string'?input.description.slice(0,2000):participant.preferences?.description,updatedAt:this.time(),submittedAt:this.time()};
      this.invalidate(state,'Confirmed whole basket options changed. Check a new plan.');
    });
  }
  createLot(userId: UserId,input: Record<string,unknown>) {
    this.organizer(userId);
    this.mutate(state=>{
      if(state.collection.protocolVersion!==2) throw new DomainError('V2_REQUIRED','Own lots require V2.');
      if(Object.keys(state.operations).length) throw new DomainError('PAYMENT_HISTORY','This workspace contains payment history. Use a fresh workspace to create another lot.',409);
      const count=Number(input.buyerCount ?? 4);
      if(!Number.isInteger(count) || count<2 || count>6) throw new DomainError('BUYER_COUNT','Choose two to six buyers.');
      const photos=input.photos;
      if(!Array.isArray(photos)||!photos.length||photos.length>12||photos.some(p=>typeof p!=='string'||!safeImage(p))) throw new DomainError('INVALID_PHOTOS','Add a photo of your own lot.');
      const deadline=textField(input.reservationExpiresAt,'reservationExpiresAt',100);
      const p=input.pickup as Record<string,unknown>;
      const pickup={location:textField(p?.location,'location',200),startsAt:textField(p?.startsAt,'startsAt',100),endsAt:textField(p?.endsAt,'endsAt',100)};
      if(!Number.isFinite(Date.parse(deadline))||Date.parse(deadline)<=this.now().getTime()||!Number.isFinite(Date.parse(pickup.startsAt))||!Number.isFinite(Date.parse(pickup.endsAt))||Date.parse(pickup.startsAt)<=Date.parse(deadline)||Date.parse(pickup.endsAt)<=Date.parse(pickup.startsAt)) throw new DomainError('INVALID_DATE','Choose a future reservation deadline and a later pickup period.');
      const total=money(input.collectionPriceCents,'collectionPriceCents',false);
      state.collection={...createV2Collection(this.now(),'workshop',this.options.recipientId),name:textField(input.name,'name',160),
        description:'One whole mixed lot. One pickup.',buyerCount:count,items:[],photos:photos as string[],collectionPriceCents:total,totalCents:total,
        reservationExpiresAt:new Date(deadline).toISOString(),pickup};
      state.participants=v2Participants(count);state.plans=[];state.currentPlanId=undefined;state.noSolution=undefined;state.agentQuestion=undefined;
      state.packing=[];state.invitationTokens={};state.paymentDeadline=undefined;
    });
  }
  addItem(userId:UserId,input:Record<string,unknown>) {
    this.organizer(userId); this.mutate(state=>{
      if(state.collection.protocolVersion!==2||state.collection.preferencesOpened||!this.editingAllowed(state)) throw new DomainError('CATALOG_LOCKED','Add or remove items before buyers submit their needs.',409);
      if(state.collection.items.length>=24) throw new DomainError('ITEM_LIMIT','This MVP supports up to 24 individually identified items.');
      const image=typeof input.imageUrl==='string'?input.imageUrl:state.collection.photos[0];
      if(!safeImage(image)) throw new DomainError('INVALID_IMAGE','Choose an item photo.');
      const next=Math.max(0,...state.collection.items.map(i=>Number(i.id)||0))+1;
      state.collection.items.push({id:String(next).padStart(2,'0'),name:textField(input.name??'New item','name',160),description:typeof input.description==='string'?input.description.slice(0,2000):'Seller description required.',
        condition:typeof input.condition==='string'?input.condition.slice(0,300):'Seller inspection required',imageUrl:image,imageRegion:imageRegion(input.imageRegion),shareCents:money(input.shareCents??0,'shareCents'),confirmed:false,needsReview:true});
      state.collection.catalogStatus='draft';state.collection.catalogVersion++;
    });
  }
  removeItem(userId:UserId,itemId:string) {
    this.organizer(userId);this.mutate(state=>{
      if(state.collection.protocolVersion!==2||state.collection.preferencesOpened||!this.editingAllowed(state)) throw new DomainError('CATALOG_LOCKED','The catalogue is locked.',409);
      state.collection.items=state.collection.items.filter(i=>i.id!==itemId);state.collection.catalogStatus='draft';state.collection.catalogVersion++;
    });
  }
  updateParticipant(userId:UserId,id:BuyerId,input:Record<string,unknown>) {
    this.organizer(userId);this.mutate(state=>{
      if(state.collection.protocolVersion!==2 || !this.editingAllowed(state)) throw new DomainError('PARTICIPANTS_LOCKED','The buyers are locked while payments are settled.',409);
      const p=this.participant(state,id);
      if((input.name!==undefined||input.email!==undefined)&&(p.preferences||p.invitedAt||Object.values(state.operations).some(o=>o.buyerId===id)))throw new DomainError('PARTICIPANTS_LOCKED','A buyer identity is locked after invitation or saved options.',409);
      if(input.active!==undefined&&state.collection.preferencesOpened)throw new DomainError('PARTICIPANTS_LOCKED','Use an explicit replacement after a buyer leaves.',409);
      if(input.name!==undefined)p.name=textField(input.name,'name',80);
      if(input.email!==undefined){const email=textField(input.email,'email',200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new DomainError('INVALID_EMAIL','Enter a valid buyer email.');if(state.participants.some(other=>other.id!==id&&other.email===email))throw new DomainError('DUPLICATE_EMAIL','Each buyer needs a distinct email.');p.email=email;}
      if(input.active!==undefined){if(typeof input.active!=='boolean')throw new DomainError('INVALID_ACTIVE','Check the buyer selection.');p.active=input.active;}
      state.collection.buyerCount=state.participants.filter(p=>p.active).length;
      if(state.collection.buyerCount<2||state.collection.buyerCount>6)throw new DomainError('BUYER_COUNT','Keep two to six active buyers.');
    });
  }
  checkCandidate(buyerId:BuyerId,itemIds:string[]) {
    const state=this.snapshot();const buyer=this.participant(state,buyerId);
    const ids=this.validIds(state,itemIds,'itemIds');
    const amount=ids.reduce((sum,id)=>sum+state.collection.items.find(i=>i.id===id)!.shareCents,0);
    const opts=buyer.preferences?.basketOptions??[];
    if(!buyer.active || !buyer.preferences || !ids.length || ids.some(id=>buyer.preferences?.rejectedItemIds?.includes(id)) || amount>buyer.preferences.budgetCents || opts.length>=2) return {feasible:false,amountCents:amount};
    const hypothetical=clone(state.participants);const target=hypothetical.find(p=>p.id===buyerId)!;
    target.preferences!.basketOptions=[...opts,{id:'unconfirmed-hypothesis',itemIds:ids,confirmedAt:this.time()}];
    const result=solveWholeBaskets(state.collection,hypothetical,this.current(state)?.assignments);
    return {feasible:Array.isArray(result) && result.some(a=>a.buyerId===buyerId&&a.itemIds.join(',')===ids.join(',')),amountCents:amount};
  }
  storeCheckedQuestion(userId:UserId,question:Omit<CheckedQuestion,'id'|'status'|'contextDigest'|'createdAt'>,expectedContext:string) {
    this.organizer(userId);this.mutate(state=>{
      if(agentContextDigest(state.collection,state.participants)!==expectedContext)throw new DomainError('STALE_CONTEXT','The basket conditions changed. Run the assistant again.',409);
      this.requireGate(this.gates(state).solve);
      if(!this.checkCandidate(question.buyerId,question.itemIds).feasible)throw new DomainError('UNCHECKED_QUESTION','The proposed option does not unlock a complete checked plan.',409);
      state.agentQuestion={...question,id:randomUUID(),status:'draft',contextDigest:expectedContext,createdAt:this.time()};
    });
  }
  sendQuestion(userId:UserId,id:string) {this.organizer(userId);this.mutate(state=>{
    const q=state.agentQuestion;if(!q||q.id!==id||q.contextDigest!==agentContextDigest(state.collection,state.participants))throw new DomainError('STALE_QUESTION','Check the current basket options again.',409);
    if(this.expired(state))throw new DomainError('EXPIRED','The reservation has ended.',409);
    if(q.status!=='draft')throw new DomainError('QUESTION_SENT','This question is no longer a draft.',409);
    q.status='sent';
  });}
  answerQuestion(userId:UserId,id:string,accept:boolean) {
    const buyerId=this.buyer(userId);const state=this.snapshot();const q=state.agentQuestion;
    if(!q||q.id!==id||q.buyerId!==buyerId||q.status!=='sent'||q.contextDigest!==agentContextDigest(state.collection,state.participants))throw new DomainError('STALE_QUESTION','This question is no longer current.',409);
    if(accept){const prefs=this.participant(state,buyerId).preferences!;this.saveBasketOptions(userId,{basketOptions:[...(prefs.basketOptions??[]).map(o=>o.itemIds),q.itemIds],budgetCents:prefs.budgetCents,confirmed:true});}
    this.mutate(s=>{if(s.agentQuestion?.id===id){s.agentQuestion.status=accept?'accepted':'declined';s.agentQuestion.contextDigest=agentContextDigest(s.collection,s.participants);}});
  }
  async expireReservations() {
    const state=this.snapshot();if(state.collection.protocolVersion!==2||!this.expired(state))return;
    if(state.plans.some(p=>p.status==='sent'||p.status==='draft'))this.mutate(s=>{
      for(const p of s.plans)if(['sent','draft'].includes(p.status)){p.status='invalidated';p.invalidationReason='The reservation ended. Hold cancellation requested.';p.invalidatedAt=this.time();}
      s.packing=[];
    });
    await this.compensateInvalidPlans();
  }
  private invalidate(state: DomainState, reason: string) {
    const plan = this.current(state); if (!plan || plan.status === 'invalidated') return;
    if (!this.editingAllowed(state)) throw new DomainError('PAYMENTS_STARTED', 'Payments are being settled.', 409);
    plan.status = 'invalidated'; plan.invalidatedAt = this.time(); plan.invalidationReason = reason; state.packing = []; state.noSolution = undefined;
  }
  solve(userId: UserId) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).solve);
      const previous = this.current(state);
      const result = state.collection.protocolVersion===2 ? solveWholeBaskets(state.collection,state.participants,previous?.assignments) : solveAllocation(state.collection, state.participants);
      if (!Array.isArray(result)) { if (previous && previous.status !== 'invalidated') this.invalidate(state, 'No complete solution is available.'); state.noSolution = result; return; }
      if (previous && previous.status !== 'invalidated') this.invalidate(state, 'A new plan version was calculated.');
      const plan: AllocationPlan = { ...(state.collection.protocolVersion===2?{contractVersion:2 as const}:{}),id: randomUUID(), version: Math.max(0, ...state.plans.map(p => p.version)) + 1,
        status: 'draft', assignments: result, consents: {}, payments: {}, createdAt: this.time() };
      for (const assignment of result) {
        const participant = this.participant(state, assignment.buyerId);
        const past = previous && previous.assignments.some(a => a.buyerId === assignment.buyerId && a.termsDigest === assignment.termsDigest && consentValid(previous, a)) &&
          (!participant.withdrawnAt || previous.consents[assignment.buyerId]!.acceptedAt > participant.withdrawnAt) &&
          !Object.values(state.operations).some(op => op.planId === previous.id && op.kind === 'capture') ? previous : undefined;
        if (past && (state.collection.protocolVersion!==2 || past.consents[assignment.buyerId]?.contract===V2_CONTRACT)) {
          const consent = past.consents[assignment.buyerId]!; plan.consents[assignment.buyerId] = { ...consent, preservedFromPlanId: past.id };
          const old= this.payment(state,past,assignment.buyerId);
          if(state.collection.protocolVersion===2 && old.authorization?.status==='AUTHORIZED' && old.authorization.termsDigest===assignment.termsDigest && !old.void && !old.refund && (!old.authorization.expiresAt || Date.parse(old.authorization.expiresAt)>this.now().getTime()) && !this.expired(state)) {
            plan.payments[assignment.buyerId]={orderOperationId:old.order?.id,authorizationOperationId:old.authorization.id};
          }
        }
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
      plan.consents[buyerId] = { ...(state.collection.protocolVersion===2?{contract:V2_CONTRACT}:{}), buyerId, termsDigest: digest, acceptedAt: this.time(), sourcePlanId: plan.id };
    });
  }
  async withdraw(userId: UserId) {
    const buyerId = this.buyer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).withdraw); const participant = this.participant(state, buyerId);
      if(state.collection.protocolVersion===2&&!participant.active)throw new DomainError('INACTIVE','You already left this purchase.',409);
      participant.active = false; participant.withdrawnAt = this.time(); this.invalidate(state, `${participant.name} withdrew from the purchase.`);
      if(state.collection.protocolVersion===2) state.collection.buyerCount=state.participants.filter(p=>p.active).length;
      const result = solveAllocation(state.collection, state.participants); if (!Array.isArray(result)) state.noSolution = result;
    });
    await this.compensateInvalidPlans();
  }
  async replace(userId: UserId, leavingBuyerId: BuyerId, replacementBuyerId: BuyerId) {
    this.organizer(userId); this.mutate(state => {
      this.requireGate(this.gates(state).withdraw);
      if (leavingBuyerId === replacementBuyerId) throw new DomainError('INVALID_REPLACEMENT', 'Choose a different person.');
      const leaving = this.participant(state, leavingBuyerId), replacement = this.participant(state, replacementBuyerId);
      if(state.collection.protocolVersion===2&&(leaving.active||!leaving.withdrawnAt||leaving.replacedBy))throw new DomainError('WITHDRAWAL_REQUIRED','A buyer must explicitly leave before this slot can be replaced.',409);
      if (replacement.active) throw new DomainError('ALREADY_ACTIVE', 'This person is already active.');
      leaving.active = false; leaving.withdrawnAt = this.time(); replacement.active = true; replacement.invitedAt = this.time();
      if(state.collection.protocolVersion===2) {
        leaving.replacedBy=replacementBuyerId;
        const slot=state.participants.indexOf(leaving);state.participants=state.participants.filter(p=>p.id!==replacementBuyerId);state.participants.splice(slot,0,replacement);
        state.collection.buyerCount=state.participants.filter(p=>p.active).length;
      }
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
      ...(state.collection.protocolVersion===2?{termsDigest:assignment.termsDigest}:{}),
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
        if (this.pendingChanges(state, current.id)) {
          current.checkNeeded = true; current.lastError = awaitingResourceId; return undefined;
        }
        const age = this.now().getTime() - Date.parse(current.createdAt);
        if (!Number.isFinite(age) || age < 0 || age >= SAFE_REPLAY_WINDOW_MS) {
          current.status = 'UNKNOWN'; current.checkNeeded = true;
          current.lastError = 'The safe retry window for this operation has expired. Manual reconciliation with PayPal is required; no new charge will be created.';
          return undefined;
        }
        const plan = state.plans.find(p => p.id === current.planId);
        if (['authorize', 'capture'].includes(current.kind) && (!plan || this.needsCaptureReview(state, plan) || this.expired(state) || !this.currentCaptureTerms(state, plan) ||
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
      const checkId = this.applyResult(operation.id, result, true);
      if (checkId) await this.reconcileOperation(checkId, true);
      if (this.snapshot().paymentObservations?.[operation.id]?.checkNeeded) await this.reconcileObservation(operation.id);
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
  private applyResult(operationId: string, result: ProviderResult, commandResponse = false) {
    return this.mutate(state => {
      const operation = state.operations[operationId]; if (!operation) throw new DomainError('NOT_FOUND', 'Operation not found.', 404);
      if (isFinal(operation)) return;
      if (!commandResponse && operation.kind === 'capture' && !operation.providerId &&
        this.pendingChanges(state, operation.id)?.changes.some(change => change.ownerOperationId)) return;
      const parent = operation.kind === 'authorize' ? result.orderId : operation.kind === 'capture' ? result.authorizationId : operation.kind === 'refund' ? result.captureId : undefined;
      if (!result.providerId || (operation.providerId && operation.providerId !== result.providerId) || (parent && parent !== operation.parentProviderId)) {
        operation.status = 'UNKNOWN'; operation.checkNeeded = true; operation.updatedAt = this.time();
        operation.lastError = 'The provider resource does not match the saved payment. Its identity needs checking.'; return;
      }
      const financialFinal = (operation.kind === 'authorize' && result.status === 'AUTHORIZED') ||
        (['capture', 'refund'].includes(operation.kind) && result.status === 'COMPLETED') ||
        (operation.kind === 'capture' && ['FAILED', 'CANCELLED'].includes(result.status));
      const permitted: Record<OperationKind, string[]> = {
        order: ['CREATED', 'APPROVED', 'AUTHORIZED', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        authorize: ['AUTHORIZED', 'VOIDED', 'PENDING', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        capture: ['COMPLETED', 'PENDING', 'CANCELLED', 'FAILED', 'UNKNOWN'],
        void: ['VOIDED', 'PENDING', 'FAILED', 'UNKNOWN'], refund: ['COMPLETED', 'PENDING', 'FAILED', 'UNKNOWN'],
      };
      if (!permitted[operation.kind].includes(result.status)) {
        operation.status = 'UNKNOWN'; operation.checkNeeded = true; operation.updatedAt = this.time();
        operation.lastError = 'The provider returned a status that needs checking.'; return;
      }
      if ((financialFinal && (result.amountCents !== operation.amountCents || result.currency !== operation.currency)) ||
        (operation.kind === 'refund' && ((result.amountCents !== undefined && result.amountCents !== operation.amountCents) || (result.currency !== undefined && result.currency !== operation.currency)))) {
        operation.status = 'UNKNOWN'; operation.checkNeeded = true; operation.updatedAt = this.time();
        operation.lastError = 'We are checking that the operation amount and currency match the exact plan.'; return;
      }
      operation.status = result.status; operation.providerId = result.providerId;
      const saved = state.paymentCommands?.[operationId];
      if (commandResponse && operation.kind === 'refund' && saved) saved.refundResponseId = result.providerId;
      operation.approvalUrl = result.approvalUrl ?? operation.approvalUrl; operation.updatedAt = this.time();
      operation.checkNeeded = ['UNKNOWN', 'PENDING'].includes(result.status); operation.lastError = undefined; operation.providerError = undefined;
      const checkId = this.bindPendingChanges(state, operation);
      if (operation.kind === 'authorize' && result.expiresAt) operation.expiresAt = result.expiresAt;
      if(state.collection.protocolVersion===2 && operation.kind==='authorize' && result.status==='AUTHORIZED' && !state.paymentDeadline)
        state.paymentDeadline=new Date(Math.min(Date.parse(state.collection.reservationExpiresAt),this.now().getTime()+24*3600_000)).toISOString();
      return checkId;
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
      if (payment.authorization && ['FAILED', 'CANCELLED'].includes(payment.authorization.status) && payment.authorization.parentProviderId === order.providerId)
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
        if (this.needsCaptureReview(state, plan)) { plan.status = 'reconciling'; return { kind: 'stop' as const }; }
        const views = plan.assignments.map(a => this.payment(state, plan, a.buyerId));
        if (views.some(p => p.capture && ['FAILED', 'CANCELLED'].includes(p.capture.status))) {
          plan.status = 'failed'; plan.failureReason = 'One capture failed. The purchase is paused; confirmed captures are being refunded and the remaining authorizations voided.';
          return { kind: 'compensate' as const };
        }
        if (views.some(p => isUnknown(p.capture))) { plan.status = 'reconciling'; return { kind: 'stop' as const }; }
        if (views.every(p => p.capture?.status === 'COMPLETED')) {
          plan.status = 'paid';
          if (!state.packing.length) state.packing = plan.assignments.map(a => ({ buyerId: a.buyerId, buyerName: this.participant(state, a.buyerId).name,
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
  async processPendingCompensation() { await this.expireReservations(); await this.compensateInvalidPlans(); }
  private nextCompensation(state: DomainState, planId: string, assignment: Assignment) {
    const plan = state.plans.find(p => p.id === planId)!;
    const payment = this.payment(state, plan, assignment.buyerId);
    const { capture, authorization, order } = payment;
    if (state.collection.protocolVersion === 2 && plan.status === 'invalidated') {
      const current = this.current(state), participant = this.participant(state, assignment.buyerId);
      const replacement = current?.id !== plan.id ? current?.assignments.find(a => a.buyerId === assignment.buyerId) : undefined;
      const sameTerms = assignment.termsDigest === termsDigest(state.collection, assignment.buyerId, assignment.itemIds, assignment.totalCents);
      const stillAccepted = participant.preferences?.basketOptions?.some(o => o.itemIds.slice().sort().join(',') === assignment.itemIds.slice().sort().join(','));
      const retained = authorization && current?.id !== plan.id && current?.payments[assignment.buyerId]?.authorizationOperationId === authorization.id;
      if (retained || (!this.expired(state) && !replacement && participant.active && sameTerms && stillAccepted && plan.consents[assignment.buyerId]?.contract === V2_CONTRACT && !capture)) return;
    }
    const prepareOnce = (kind: 'refund' | 'void', parentId?: string) => {
      if (!parentId || payment[kind]) return;
      const existing = state.collection.protocolVersion === 2 && Object.values(state.operations).find(op => op.kind === kind && op.parentProviderId === parentId);
      if (existing) { plan.payments[assignment.buyerId]![kind === 'refund' ? 'refundOperationId' : 'voidOperationId'] = existing.id; return; }
      return this.prepareOperation(state, plan, assignment.buyerId, kind, parentId);
    };
    if (isUnknown(capture) || this.captureFullyRefunded(state, capture)) return;
    if (capture?.status === 'COMPLETED') return prepareOnce('refund', capture.providerId);
    if (state.mode === 'sandbox' && capture?.providerId && ['FAILED', 'CANCELLED'].includes(capture.status) &&
      authorization?.providerId && !['VOIDED', 'FAILED', 'CANCELLED'].includes(authorization.status) && !payment.void &&
      state.paymentObservations?.[authorization.id]?.holdCheckedForCapture !== capture.id) {
      // A declined capture says nothing about the disposition of its separate hold.
      this.observeProviderChange(state, state.operations[authorization.id], 'CHECK_AFTER_CAPTURE_DECLINE');
      state.paymentObservations![authorization.id].holdCheckedForCapture = capture.id;
      return { checkAuthorization: authorization.id };
    }
    if (isUnknown(authorization) || isUnknown(order)) return;
    if (authorization?.status === 'AUTHORIZED') return prepareOnce('void', authorization.providerId);
    if (order && ['CREATED', 'APPROVED'].includes(order.status) && !authorization) {
      order.status = 'CANCELLED'; order.checkNeeded = false; order.updatedAt = this.time();
    }
  }
  private async compensatePlan(planId: string) {
    for (const assignment of this.snapshot().plans.find(p => p.id === planId)?.assignments ?? []) {
      for (;;) {
        const next = this.mutate(state => this.nextCompensation(state, planId, assignment));
        if (next && 'checkAuthorization' in next) { await this.reconcileObservation(next.checkAuthorization); continue; }
        if (next) await this.dispatch(next);
        break;
      }
    }
  }
  async reconcile(userId: UserId, operationId?: string) {
    const state = this.snapshot();
    const operations = operationId ? [state.operations[operationId]].filter(Boolean) : Object.values(state.operations).filter(op => isUnknown(op) || state.paymentObservations?.[op.id]?.checkNeeded || this.pendingChanges(state, op.id));
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
      // A legacy named refund without evidence from the saved POST might have
      // been attached by parent capture alone. Its ID cannot authorize a new key.
      if (current.status !== 'FAILED' || (failed.kind === 'refund' && (payment.capture?.status !== 'COMPLETED' ||
        (failed.providerId && state.paymentCommands?.[failed.id]?.refundResponseId !== failed.providerId))) ||
        (failed.kind === 'void' && (payment.authorization?.status !== 'AUTHORIZED' || payment.authorization.checkNeeded ||
          payment.capture?.status === 'COMPLETED' || isUnknown(payment.capture) || this.captureFullyRefunded(state, payment.capture))))
        throw new DomainError('RETRY_NOT_ALLOWED', 'The provider reported a payment change. Check the existing resource before requesting another reversal.', 409);
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
      if (state.paymentObservations?.[failed.id] || this.pendingChanges(state, failed.id)) throw new DomainError('RETRY_NOT_ALLOWED', 'The existing authorization resource must be reconciled without repeating its command.', 409);
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
  private async reconcileOperation(operationId: string, readOnly = false) {
    let state = this.snapshot(); const operation = state.operations[operationId];
    if (operation && this.pendingChanges(state, operationId) && !operation.providerId) {
      // An order lists its authorization/capture. A capture can have many refunds;
      // it cannot identify our lost refund response. Neither case permits replay.
      if (operation.kind === 'refund') return;
      const competing = this.pendingChanges(state, operationId)?.changes.find(change => change.ownerOperationId);
      if (competing?.ownerOperationId) {
        // An external capture could also appear as this order's child. Only the
        // saved command's own response can resolve ownership while it is in flight.
        const lease = state.paymentCommands?.[operationId]?.leaseExpiresAt;
        if (lease && Date.parse(lease) > this.now().getTime()) return;
        const ownerId = competing.ownerOperationId;
        this.mutate(s => this.quarantineCapture(s, s.operations[ownerId], changeId(competing), competing.eventType));
        await this.reconcileObservation(ownerId);
        return;
      }
      try {
        const provider = this.options.paymentProvider;
        const plan = state.plans.find(p => p.id === operation.planId)!;
        const orderId = operation.kind === 'authorize' ? operation.parentProviderId : this.payment(state, plan, operation.buyerId).order?.providerId;
        if (!provider || !orderId) throw new Error('The saved order is unavailable');
        const order = await provider.getOrder(orderId);
        const childId = operation.kind === 'authorize' ? order.authorizationId : order.captureId;
        if (order.providerId !== orderId || order.amountCents !== operation.amountCents || order.currency !== operation.currency || !childId ||
          (operation.kind === 'capture' && order.authorizationId && order.authorizationId !== operation.parentProviderId))
          throw new Error('The original resource identity is not confirmed');
        this.mutate(s => {
          const saved = s.operations[operationId];
          const pending = this.pendingChanges(s, operationId);
          if (!pending || pending.changes.some(change => change.ownerOperationId)) return;
          if (saved.providerId && saved.providerId !== childId) throw new Error('The original resource identity is ambiguous');
          saved.providerId = childId; this.bindPendingChanges(s, saved);
          if (!s.paymentObservations?.[saved.id]) this.observeProviderChange(s, saved, 'CHECK_RECOVERED_RESOURCE');
        });
        await this.reconcileOperation(operationId, true);
      } catch {
        this.mutate(s => {
          const saved = s.operations[operationId]; if (saved.providerId || !this.pendingChanges(s, operationId)) return;
          saved.checkNeeded = true; saved.lastError = awaitingResourceId;
        });
      }
      return;
    }
    if (operation?.providerId && this.pendingChanges(state, operationId)) {
      this.mutate(s => this.bindPendingChanges(s, s.operations[operationId])); state = this.snapshot();
    }
    if (state.paymentObservations?.[operationId]) { await this.reconcileObservation(operationId); return; }
    if (!operation || (isFinal(operation) && !(readOnly && operation.kind === 'order' && operation.providerId))) return;
    this.mutate(s => { s.operations[operationId].reconcileAttempts++; s.operations[operationId].updatedAt = this.time(); });
    try {
      let result: ProviderResult;
      if (this.options.mode === 'rehearsal') result = this.rehearsalResult(operation, true);
      else {
        const provider = this.options.paymentProvider; if (!provider) return;
        const plan = state.plans.find(p => p.id === operation.planId)!; const payment = this.payment(state, plan, operation.buyerId);
        if (operation.kind === 'order') {
          if (!operation.providerId) { if (!readOnly) await this.dispatch(operation, true); return; }
          result = await provider.getOrder(operation.providerId);
          if (await this.checkOrderCapture(operation.providerId, result)) return;
        } else if (operation.kind === 'authorize') {
          if (operation.providerId) result = await provider.getAuthorization(operation.providerId);
          else if (operation.parentProviderId) {
            const order = await provider.getOrder(operation.parentProviderId);
            if (order.providerId !== operation.parentProviderId || order.amountCents !== operation.amountCents || order.currency !== operation.currency)
              throw new PayPalProviderError('PAYPAL_AMOUNT_MISMATCH', 'The existing order does not match the saved authorization amount.', true);
            if (await this.checkOrderCapture(operation.parentProviderId, order)) return;
            if (!order.authorizationId) { if (!readOnly) await this.dispatch(operation, true); return; }
            result = await provider.getAuthorization(order.authorizationId);
            if (result.providerId !== order.authorizationId) throw new Error('The authorization does not match the saved order.');
          } else { if (!readOnly) await this.dispatch(operation, true); return; }
        } else if (operation.kind === 'capture') {
          if (operation.providerId) result = await provider.getCapture(operation.providerId);
          else if (payment.order?.providerId) {
            const order = await provider.getOrder(payment.order.providerId);
            if (order.providerId !== payment.order.providerId || (order.authorizationId && order.authorizationId !== operation.parentProviderId))
              throw new Error('The original capture does not match its order.');
            if (!order.captureId) { if (!readOnly) await this.dispatch(operation, true); return; }
            result = await provider.getCapture(order.captureId);
            if (result.providerId !== order.captureId) throw new Error('The capture does not match the saved order.');
          } else { if (!readOnly) await this.dispatch(operation, true); return; }
        } else if (operation.kind === 'void') {
          if (!operation.parentProviderId) return;
          result = await provider.getAuthorization(operation.parentProviderId);
          if (result.providerId !== operation.parentProviderId) throw new Error('The cancellation does not match the saved authorization.');
          if (result.status === 'AUTHORIZED' && !operation.providerId) { if (!readOnly) await this.dispatch(operation, true); return; }
          if (result.status !== 'VOIDED') result = { ...result, status: result.status === 'AUTHORIZED' ? 'PENDING' : 'UNKNOWN' };
        } else {
          if (!operation.providerId) { if (!readOnly) await this.dispatch(operation, true); return; }
          result = await provider.getRefund(operation.providerId);
        }
      }
      this.applyResult(operationId, result);
      if (this.snapshot().paymentObservations?.[operationId]?.checkNeeded) await this.reconcileObservation(operationId);
    } catch (error) {
      this.mutate(s => { const op = s.operations[operationId]; if (!isFinal(op)) { op.status = 'UNKNOWN'; op.checkNeeded = true; op.lastError = 'We are still checking the result of the existing operation.'; op.providerError = providerErrorInfo(error); } });
    }
  }
  private adverseResourceEvent(type: string) {
    if (type.endsWith('REVIEW_REQUIRED')) return true;
    if (type.startsWith('PAYMENT.REFUND.')) return /\.(COMPLETED|SUCCEEDED)$/.test(type);
    return /\.(VOIDED|EXPIRED|REVERSED|REFUNDED|PARTIALLY_REFUNDED|DECLINED|DENIED|FAILED|CANCELLED)$/.test(type);
  }
  private quarantineCapture(state: DomainState, owner: PaymentOperation, resourceId: string, eventType: string) {
    if (!owner.providerId || state.paymentObservations?.[owner.id]?.unattributedCapture) return;
    const previous = state.paymentObservations?.[owner.id];
    (state.paymentObservations ??= {})[owner.id] = {
      ...previous, providerId: owner.providerId, status: 'UNKNOWN', checkNeeded: true, updatedAt: this.time(),
      generation: (previous?.generation ?? 0) + 1, unattributedCapture: { resourceId: resourceId.slice(0, 128), eventType }, lastError: manualCaptureReview,
    };
    for (const plan of state.plans) if (['capturing', 'paid'].includes(plan.status) && this.needsCaptureReview(state, plan)) plan.status = 'reconciling';
  }
  private captureOwner(state: DomainState, authorizationId?: string, orderId?: string) {
    if (!authorizationId && !orderId) return;
    const operations = Object.values(state.operations);
    const orders = orderId ? operations.filter(op => op.kind === 'order' && op.providerId === orderId) : [];
    const holds = operations.filter(op => op.kind === 'authorize' && op.providerId &&
      (authorizationId ? op.providerId === authorizationId : op.parentProviderId === orderId));
    if (orders.length > 1 || holds.length > 1) return;
    const hold = holds[0], order = orders[0];
    if (hold && orderId && hold.parentProviderId !== orderId) return;
    if (order && hold && order.buyerId !== hold.buyerId) return;
    return hold ?? order;
  }
  private currentUnidentified(state: DomainState, op: PaymentOperation) {
    return !op.providerId && (!isFinal(op) || !!this.pendingChanges(state, op.id)) && (state.paymentCommands?.[op.id]?.attempts ?? 0) > 0 &&
      state.plans.some(plan => {
        const payment = plan.payments[op.buyerId];
        return payment && (op.kind === 'authorize' ? payment.authorizationOperationId : op.kind === 'capture' ? payment.captureOperationId : payment.refundOperationId) === op.id;
      });
  }
  private rememberChange(state: DomainState, op: PaymentOperation, id: string, type: string, refundId?: string, owner?: PaymentOperation) {
    const entries = op.kind === 'capture' ? (state.pendingCaptureChanges ??= {}) : (state.pendingResourceChanges ??= {});
    const pending = entries[op.id] ??= { changes: [] };
    const seen = pending.changes.find(change => changeId(change) === id && change.eventType === type && change.refundId === refundId);
    if (seen) { if (owner) seen.ownerOperationId = owner.id; return true; }
    if (pending.changes.length >= MAX_RESOURCE_CHANGE_HINTS) { pending.overflow = true; return false; }
    pending.changes.push({ ...(op.kind === 'capture' ? { captureId: id } : { resourceId: id }), eventType: type,
      ...(refundId ? { refundId } : {}), ...(owner ? { ownerOperationId: owner.id } : {}) });
    return true;
  }
  private captureAtParent(state: DomainState, owner: PaymentOperation, type: string, captureId?: string, refundId?: string) {
    const local = Object.values(state.operations).filter(op => op.kind === 'capture' && owner.kind === 'authorize' && op.parentProviderId === owner.providerId);
    if (captureId && local.some(op => op.providerId === captureId)) return;
    const pending = local.find(op => this.currentUnidentified(state, op));
    if (captureId && pending && this.rememberChange(state, pending, captureId, type, refundId, owner)) return;
    this.quarantineCapture(state, owner, captureId ?? refundId!, type);
    return owner;
  }
  private async checkOrderCapture(orderId: string, result: ProviderResult) {
    const captureId = result.captureId;
    if (result.providerId !== orderId || !captureId) return false;
    const parent = this.mutate(state => {
      const owner = this.captureOwner(state, result.authorizationId, orderId);
      if (owner) return this.captureAtParent(state, owner, 'ORDER_REPORTED_CAPTURE', captureId);
    });
    if (parent) await this.reconcileObservation(parent.id);
    return !!parent;
  }
  private observeProviderChange(state: DomainState, operation: PaymentOperation, type: string, refundId?: string) {
    if (!['authorize', 'capture'].includes(operation.kind) || !operation.providerId) return;
    const existing = state.paymentObservations?.[operation.id];
    if (existing?.unattributedCapture) return;
    if (existing && !existing.checkNeeded && (operation.kind === 'authorize' ? ['VOIDED', 'FAILED', 'CANCELLED'].includes(existing.status) : this.captureFullyRefunded(state, operation))) return;
    const refundChecks = clone(existing?.refundChecks ?? []);
    let overflow = existing?.refundChecksOverflow;
    if (refundId) {
      const saved = refundChecks.find(check => check.providerId === refundId);
      if (saved) { if (saved.status !== 'COMPLETED') delete saved.status; }
      else if (refundChecks.length < MAX_RESOURCE_CHANGE_HINTS) refundChecks.push({ providerId: refundId });
      else overflow = true;
    }
    // A failed refund is not a reversal of the original capture. Its exact
    // refund resource must be checked before an intact capture can be used again.
    const previousAdverse = refundId && existing?.adverseEventType && !this.adverseResourceEvent(existing.adverseEventType) ? undefined : existing?.adverseEventType;
    (state.paymentObservations ??= {})[operation.id] = { providerId: operation.providerId, status: 'UNKNOWN', checkNeeded: true, updatedAt: this.time(),
      generation: (existing?.generation ?? 0) + 1, holdCheckedForCapture: existing?.holdCheckedForCapture,
      adverseEventType: previousAdverse ?? (this.adverseResourceEvent(type) ? type : undefined),
      ...(refundChecks.length ? { refundChecks } : {}), ...(overflow ? { refundChecksOverflow: true } : {}),
      lastError: 'We are checking the payment change reported by PayPal. No payment command will be repeated.' };
    if (operation.kind === 'capture' && (this.adverseResourceEvent(type) || refundId)) for (const plan of state.plans) {
      if (plan.status === 'paid' && plan.payments[operation.buyerId]?.captureOperationId === operation.id) plan.status = 'reconciling';
    }
  }
  private bindPendingChanges(state: DomainState, operation: PaymentOperation) {
    const pending = this.pendingChanges(state, operation.id);
    if (!pending || !operation.providerId) return;
    if (state.pendingCaptureChanges) delete state.pendingCaptureChanges[operation.id];
    if (state.pendingResourceChanges) delete state.pendingResourceChanges[operation.id];
    const matched = pending.changes.filter(change => changeId(change) === operation.providerId);
    if (operation.kind === 'refund') return isUnknown(operation) && (matched.length > 0 || pending.overflow) ? operation.id : undefined;
    for (const change of matched)
      this.observeProviderChange(state, operation, change.eventType, change.refundId);
    if (pending.overflow) {
      const review = 'UNMATCHED_PAYMENT_CHANGE_REVIEW_REQUIRED';
      this.observeProviderChange(state, operation, review);
      state.paymentObservations![operation.id].adverseEventType ??= review;
    }
    const competing = pending.changes.find(change => change.ownerOperationId && changeId(change) !== operation.providerId);
    if (competing?.ownerOperationId) {
      this.quarantineCapture(state, state.operations[competing.ownerOperationId], changeId(competing), competing.eventType);
      return competing.ownerOperationId;
    }
  }
  /** Lifecycle checks only GET the exact saved resource; they never replay its command. */
  private async reconcileObservation(operationId: string) {
    const state = this.snapshot(); const operation = state.operations[operationId];
    const observation = state.paymentObservations?.[operationId];
    if (!operation || !observation?.checkNeeded) return;
    this.mutate(s => { s.operations[operationId].reconcileAttempts++; });
    try {
      const provider = this.options.paymentProvider;
      if (!provider) throw new DomainError('PAYPAL_NOT_CONFIGURED', 'PayPal sandbox is not configured.', 503);
      if (observation.unattributedCapture) {
        // Reading the actual parent can establish that its hold was spent, but
        // cannot turn an external payment into a response to a LOTSPLIT command.
        const parent = operation.kind === 'order' ? await provider.getOrder(observation.providerId) : await provider.getAuthorization(observation.providerId);
        if (parent.providerId === observation.providerId) this.mutate(s => { s.paymentObservations![operationId].rawStatus = parent.rawStatus ?? parent.status; });
        return;
      }
      const result = operation.kind === 'authorize' ? await provider.getAuthorization(observation.providerId) : await provider.getCapture(observation.providerId);
      const parent = operation.kind === 'authorize' ? result.orderId : result.authorizationId;
      if (result.providerId !== observation.providerId || (parent && parent !== operation.parentProviderId))
        throw new PayPalProviderError('PAYPAL_ID_MISMATCH', 'The provider returned a different resource.', true);
      if ((result.amountCents !== undefined && result.amountCents !== operation.amountCents) || (result.currency !== undefined && result.currency !== operation.currency))
        throw new PayPalProviderError('PAYPAL_AMOUNT_MISMATCH', 'The resource does not match the saved payment.', true);
      if (operation.kind === 'authorize' && ['CAPTURED', 'PARTIALLY_CAPTURED'].includes(result.rawStatus ?? '')) {
        const unowned = this.mutate(s => {
          if (s.paymentObservations?.[operationId]?.generation !== observation.generation) return true;
          const local = Object.values(s.operations).some(op => op.kind === 'capture' && op.parentProviderId === observation.providerId &&
            (isUnknown(op) || op.status === 'COMPLETED' || this.captureFullyRefunded(s, op)));
          if (!local) this.quarantineCapture(s, operation, observation.providerId, 'AUTHORIZATION_REPORTED_CAPTURE');
          return !local;
        });
        if (unowned) return;
      }
      const refundResults = new Map<string, ProviderResult['status']>();
      if (operation.kind === 'capture' && result.status === 'COMPLETED' && result.amountCents === operation.amountCents && result.currency === operation.currency) {
        for (const check of observation.refundChecks ?? []) {
          if (['FAILED', 'CANCELLED', 'COMPLETED'].includes(check.status ?? '')) continue;
          const refund = await provider.getRefund(check.providerId);
          if (refund.providerId !== check.providerId || (refund.captureId && refund.captureId !== observation.providerId))
            throw new PayPalProviderError('PAYPAL_ID_MISMATCH', 'The provider returned a different refund resource.', true);
          const compatibleMoney = (refund.amountCents === undefined || (Number.isSafeInteger(refund.amountCents) && refund.amountCents > 0 && refund.amountCents <= operation.amountCents)) &&
            (refund.currency === undefined || refund.currency === operation.currency);
          const failed = ['FAILED', 'CANCELLED'].includes(refund.status);
          refundResults.set(check.providerId, compatibleMoney && (failed || (refund.amountCents !== undefined && refund.currency === operation.currency)) ? refund.status : 'UNKNOWN');
        }
      }
      // An older GET must not settle an observation created during that read.
      const latest = this.snapshot();
      if (latest.paymentObservations?.[operationId]?.generation !== observation.generation) return;
      // While the POST is outstanding, its command history belongs to its own
      // response. This GET still closes gates through the independent observation.
      if (!isFinal(operation) && !latest.paymentCommands?.[operationId]?.leaseToken) this.applyResult(operationId, result);
      this.mutate(s => {
        const current = s.paymentObservations![operationId];
        // Once release is confirmed, a delayed positive response cannot resurrect it.
        if (current.generation !== observation.generation || (!current.checkNeeded && ['VOIDED', 'FAILED', 'CANCELLED'].includes(current.status))) return;
        for (const check of current.refundChecks ?? []) if (refundResults.has(check.providerId) && !['FAILED', 'CANCELLED', 'COMPLETED'].includes(check.status ?? '')) check.status = refundResults.get(check.providerId);
        const refundsFailed = !current.refundChecksOverflow && (current.refundChecks ?? []).every(check => ['FAILED', 'CANCELLED'].includes(check.status ?? ''));
        const exactAmount = result.amountCents === operation.amountCents && result.currency === operation.currency;
        const positive = result.status === (operation.kind === 'authorize' ? 'AUTHORIZED' : 'COMPLETED') && exactAmount && refundsFailed;
        const unavailable = operation.kind === 'authorize' ? ['VOIDED', 'FAILED', 'CANCELLED'].includes(result.status)
          : exactAmount && (['FAILED', 'CANCELLED'].includes(result.status) || result.rawStatus === 'REFUNDED');
        current.status = unavailable ? (operation.kind === 'capture' ? 'FAILED' : result.status) : positive && !current.adverseEventType ? result.status : 'UNKNOWN';
        current.checkNeeded = current.status === 'UNKNOWN'; current.updatedAt = this.time(); current.rawStatus = result.rawStatus;
        current.expiresAt = result.expiresAt ?? current.expiresAt;
        current.lastError = current.checkNeeded
          ? 'PayPal reported a payment change. Its current result still needs checking; no payment command will be repeated.'
          : unavailable ? 'PayPal confirmed that this payment resource is no longer available. The original operation remains in the payment history.' : undefined;
        if (operation.kind === 'capture' && current.status !== 'COMPLETED') {
          // A full refund and a decline both stop collection, but only the former
          // accounts for the spent authorization. Partial/unknown reads stay paused.
          for (const plan of s.plans) if (plan.status === 'paid' && plan.payments[operation.buyerId]?.captureOperationId === operationId) plan.status = 'reconciling';
        }
      });
    } catch {
      this.mutate(s => {
        const current = s.paymentObservations![operationId];
        if (current.unattributedCapture) return;
        if (current.generation !== observation.generation || (!current.checkNeeded && ['VOIDED', 'FAILED', 'CANCELLED'].includes(current.status))) return;
        current.status = 'UNKNOWN'; current.checkNeeded = true; current.updatedAt = this.time();
        current.lastError = 'We are checking the payment change reported by PayPal. No payment command will be repeated.';
      });
    }
  }
  /** Called only after the route verifies the PayPal signature. A duplicate event has no new effect. */
  async verifiedWebhook(event: unknown) {
    if (this.options.mode !== 'sandbox') throw new DomainError('SANDBOX_ONLY', 'PayPal webhooks are supported only in sandbox mode.', 409);
    const data = event as { id?: string; event_type?: string; resource?: { id?: string; links?: { rel?: unknown; href?: unknown }[]; supplementary_data?: { related_ids?: { authorization_id?: string; order_id?: string; capture_id?: string } } } };
    if (!data?.id || typeof data.id !== 'string') throw new DomainError('INVALID_WEBHOOK', 'Invalid event.');
    if (this.snapshot().webhookEventIds.includes(data.id)) return;
    const match = this.mutate(state => {
      if (state.webhookEventIds.includes(data.id!)) return [];
      state.webhookEventIds.push(data.id!);
      const type = typeof data.event_type === 'string' ? data.event_type : '';
      const resourceId = typeof data.resource?.id === 'string' && data.resource.id ? data.resource.id : undefined;
      if (!resourceId || !/^[A-Za-z0-9_-]{1,128}$/.test(resourceId) || type.length > 128) return [];
      const related = data.resource?.supplementary_data?.related_ids;
      const authorizationEvent = type.startsWith('PAYMENT.AUTHORIZATION.');
      const refundEvent = type === 'PAYMENT.CAPTURE.REFUNDED' || type.startsWith('PAYMENT.REFUND.');
      const captureEvent = type.startsWith('PAYMENT.CAPTURE.') && !refundEvent;
      const orderEvent = type.startsWith('CHECKOUT.ORDER.');
      // Extract only exact sandbox resource IDs from canonical up links. Never
      // fetch a webhook URL or infer ownership from the event's amount or status.
      const parents = new Map<string, Set<string>>();
      for (const link of Array.isArray(data.resource?.links) ? data.resource.links : []) {
        if (link?.rel !== 'up' || typeof link.href !== 'string') continue;
        const found = /^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/(checkout\/orders|payments\/authorizations|payments\/captures)\/([A-Za-z0-9_-]{1,128})$/.exec(link.href);
        if (!found || found[0] !== link.href) continue;
        const ids = parents.get(found[1]) ?? new Set<string>(); ids.add(found[2]); parents.set(found[1], ids);
      }
      const parentId = (path: string, supplied?: string) => {
        const ids = parents.get(path) ?? new Set<string>();
        if (supplied !== undefined && (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(supplied))) return;
        if (supplied) ids.add(supplied);
        return ids.size === 1 ? [...ids][0] : undefined;
      };
      const captureId = parentId('payments/captures', related?.capture_id);
      const authId = parentId('payments/authorizations', related?.authorization_id);
      const orderId = parentId('checkout/orders', related?.order_id);
      const matches = Object.values(state.operations).filter(op => {
        if (authorizationEvent) return (op.kind === 'authorize' && op.providerId === resourceId) || (op.kind === 'void' && op.parentProviderId === resourceId);
        if (captureEvent) return op.kind === 'capture' && op.providerId === resourceId;
        if (refundEvent) return (op.kind === 'refund' && op.providerId === resourceId) ||
          (op.kind === 'capture' && !!captureId && op.providerId === captureId);
        return orderEvent && ((op.kind === 'order' && op.providerId === resourceId) || (op.kind === 'authorize' && op.parentProviderId === resourceId));
      });
      // A signed hint is not a command receipt. The parent can narrow which
      // in-flight requests to watch, but never supplies their child resource ID.
      const remember = (kind: 'authorize' | 'capture' | 'refund', id?: string, parent?: string, refundId?: string) => {
        if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id) || matches.some(op => op.kind === kind)) return;
        for (const op of Object.values(state.operations)) if (op.kind === kind && (!parent || op.parentProviderId === parent) && this.currentUnidentified(state, op))
          this.rememberChange(state, op, id, type, refundId);
      };
      if (authorizationEvent) remember('authorize', resourceId, orderId);
      if ((captureEvent || refundEvent) && !matches.some(op => op.kind === 'capture' || op.kind === 'refund')) {
        const owner = this.captureOwner(state, authId, orderId);
        const childId = captureEvent ? resourceId : captureId;
        if (owner) {
          const check = this.captureAtParent(state, owner, type, childId, refundEvent ? resourceId : undefined);
          if (check) matches.push(check);
        } else remember('capture', childId, authId, refundEvent ? resourceId : undefined);
      }
      if (refundEvent) remember('refund', resourceId, captureId);
      for (const op of matches) {
        this.observeProviderChange(state, op, type, refundEvent && op.kind === 'capture' ? resourceId : undefined);
      }
      return matches.map(op => op.id);
    });
    for (const id of match) await this.reconcileOperation(id, true);
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
      if (input.packed === true) { if (parcel.checkedItemIds.length !== parcel.itemIds.length) throw new DomainError('PACKING_INCOMPLETE', 'Check every physical item in this basket.'); parcel.packedAt ??= this.time(); }
      if (input.shipped === true) { if(state.collection.protocolVersion===2)throw new DomainError('PICKUP_ONLY','V2 prepares one pickup and does not confirm shipping.');if (!parcel.packedAt) throw new DomainError('NOT_PACKED', 'Confirm that the parcel has actually been packed first.'); parcel.shippedAt ??= this.time(); }
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
    const fresh = state.collection.protocolVersion===2 ? this.freshV2('rehearsal',collectionId) : createInitialState('rehearsal', this.now(), collectionId);
    // Object.assign alone leaves optional values from the previous snapshot behind.
    delete state.currentPlanId; delete state.noSolution; delete state.agentQuestion; delete state.paymentDeadline;
    Object.assign(state, fresh, { revision: state.revision });
  }
  setRehearsalCollection(userId: UserId, collectionId: unknown) {
    this.organizer(userId);
    if (this.options.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Examples are available only in the demo rehearsal.', 403);
    if (!(this.snapshot().collection.protocolVersion===2 ? V2_EXAMPLES.some(x=>x.id===collectionId) : isDemoCollectionId(collectionId))) throw new DomainError('INVALID_DEMO_COLLECTION', 'Choose an available example collection.', 400, { collectionId: 'Invalid example collection.' });
    this.mutate(state => this.resetRehearsal(state, collectionId as DemoCollectionId));
  }
  private async setV2Scenario(userId:UserId,scenario:RehearsalScenario) {
    const allowedScenarios:RehearsalScenario[]=['start','collecting','plan','agreements','three-authorizations','ready','success','unknown','partial-failure','refund-completed','dropout','v2','incomplete','expired','hold-unknown'];
    if(!allowedScenarios.includes(scenario))throw new DomainError('INVALID_SCENARIO','Invalid scenario.');
    const collectionId=this.snapshot().rehearsalCollectionId??'workshop';
    if(scenario==='v2'&&collectionId!=='workshop')throw new DomainError('WORKSHOP_SCENARIO','Choose Workshop clearance to open the selective-repair example. Your current lot has not changed.');
    this.mutate(s=>this.resetRehearsal(s,collectionId));
    if(scenario==='start')return;
    this.mutate(s=>{for(const i of s.collection.items){i.confirmed=true;i.needsReview=false;}});this.confirmCatalog(userId);
    for(const p of this.snapshot().participants.filter(p=>p.active)){
      const d=v2Defaults(this.snapshot().collection,p.id);
      this.saveBasketOptions(p.id,{basketOptions:[d.preferredItemIds],budgetCents:d.budgetCents,description:d.description,rejectedItemIds:collectionId==='workshop'&&p.id==='maja'?['04']:[],confirmed:true});
    }
    if(scenario==='collecting')return;
    if(scenario==='incomplete'){this.mutate(s=>{s.noSolution=solveWholeBaskets(s.collection,s.participants,[],0) as NoSolution;});return;}
    if(collectionId==='workshop')this.saveBasketOptions('ola',{basketOptions:[['01','02','03'],['04','12']],budgetCents:50000,confirmed:true});
    this.solve(userId);let plan=this.current(this.snapshot())!;
    if(scenario==='plan')return;
    this.sendPlan(userId,plan.id);
    for(const [index,a] of plan.assignments.entries()){
      if(scenario==='agreements' && index===2)continue;
      this.agree(a.buyerId,plan.id,a.termsDigest);
    }
    if(scenario==='agreements')return;
    if(scenario==='hold-unknown'){
      const order=await this.authorize(plan.assignments[0].buyerId,plan.id);
      this.mutate(s=>{const op=s.operations[order.operationId];op.status='UNKNOWN';op.checkNeeded=true;op.lastError='Prepared demonstration of an interrupted checkout response.';});return;
    }
    for(const [index,a] of plan.assignments.entries()){
      if(scenario==='three-authorizations'&&index===plan.assignments.length-1)break;
      const order=await this.authorize(a.buyerId,plan.id);await this.approve(a.buyerId,order.operationId);
    }
    if(scenario==='three-authorizations'||scenario==='ready')return;
    if(scenario==='expired'){this.mutate(s=>{s.paymentDeadline=new Date(this.now().getTime()-1000).toISOString();});await this.expireReservations();return;}
    if(scenario==='dropout'||scenario==='v2'){
      await this.withdraw('bartek');if(scenario==='dropout')return;
      await this.replace(userId,'bartek','ewa');
      this.saveBasketOptions('ewa',{basketOptions:[['05','10']],budgetCents:60000,confirmed:true});
      this.saveBasketOptions('ola',{basketOptions:[['04','12'],['04','12','06','08']],budgetCents:50000,confirmed:true});
      this.solve(userId);await this.processPendingCompensation();await this.reconcile(userId);return;
    }
    if(scenario==='unknown')this.setRehearsalOutcome(userId,'unknown-ola');
    if(scenario==='partial-failure'||scenario==='refund-completed')this.setRehearsalOutcome(userId,'failure-ola');
    await this.capture(userId,plan.id);
    if(scenario==='refund-completed')await this.reconcile(userId);
  }
  async setScenario(userId: UserId, scenario: RehearsalScenario) {
    this.organizer(userId);
    if (this.options.mode !== 'rehearsal') throw new DomainError('REHEARSAL_ONLY', 'Scenarios are available only in the demo rehearsal.', 403);
    if(this.snapshot().collection.protocolVersion===2) { await this.setV2Scenario(userId,scenario); return; }
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
