import type { DemoCollectionId } from './demo-collections.js';
export type { DemoCollectionId } from './demo-collections.js';

/** All monetary values are integer grosz. Examples demonstrate generic item collections. */
export type AppMode = 'rehearsal' | 'sandbox';
export type Role = 'organizer' | 'buyer';
export type BuyerId = 'maja' | 'ola' | 'bartek' | 'jan' | 'ewa' | 'sixth';
export type UserId = 'kasia' | BuyerId;
export type Currency = 'PLN';
export interface ImageRegion {x:number;y:number;width:number;height:number}

export interface CollectionItem {
  imageRegion?:ImageRegion;
  id: string;
  name: string;
  description: string;
  condition: string;
  imageUrl: string;
  shareCents: number;
  confirmed: boolean;
  needsReview: boolean;
}
export type PublicItem = Omit<CollectionItem, 'shareCents'> & { fixedPriceCents?: number };
export interface DeliveryAddress {
  recipient: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}
export interface Preferences {
  /** V2 entries are complete human-confirmed baskets. Never mix entries. */
  basketOptions?: { id: string; itemIds: string[]; confirmedAt: string }[];
  rejectedItemIds?: string[];
  description?: string;
  preferredItemIds: string[];
  alternativeItemIds: string[];
  alternativesConfirmed: boolean;
  budgetCents: number;
  updatedAt: string;
  submittedAt?: string;
}
export interface Participant {
  id: BuyerId;
  name: string;
  email: string;
  active: boolean;
  invitedAt?: string;
  preferences?: Preferences;
  address?: DeliveryAddress;
  withdrawnAt?: string;
  replacedBy?: BuyerId;
}
export interface Collection {
  protocolVersion?: 2;
  seller?: { name: string; recipientId: string };
  pickup?: { location: string; startsAt: string; endsAt: string };
  id: string;
  name: string;
  description: string;
  currency: Currency;
  collectionPriceCents: number;
  sharedCostCents: number;
  totalCents: number;
  buyerCount: number;
  itemsPerBuyer: number;
  reservationExpiresAt: string;
  catalogStatus: 'draft' | 'confirmed';
  preferencesOpened: boolean;
  catalogVersion: number;
  items: CollectionItem[];
  photos: string[];
}
export type PublicCollection = Omit<Collection, 'items'> & { items: PublicItem[] };
export interface Assignment {
  buyerId: BuyerId;
  itemIds: string[];
  baseCents: number;
  sharedCostCents: number;
  totalCents: number;
  alternativeItemIds: string[];
  termsDigest: string;
}
export interface Consent {
  contract?: 'own-basket-group-v2';
  buyerId: BuyerId;
  termsDigest: string;
  acceptedAt: string;
  sourcePlanId: string;
  preservedFromPlanId?: string;
}
export type OperationKind = 'order' | 'authorize' | 'capture' | 'void' | 'refund';
export type OperationStatus = 'STARTED' | 'CREATED' | 'APPROVED' | 'AUTHORIZED' | 'COMPLETED' | 'PENDING' | 'VOIDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
export interface PaymentOperation {
  termsDigest?: string;
  id: string;
  idempotencyKey: string;
  kind: OperationKind;
  buyerId: BuyerId;
  planId: string;
  amountCents: number;
  currency: Currency;
  status: OperationStatus;
  source: 'rehearsal' | 'paypal-sandbox';
  providerId?: string;
  parentProviderId?: string;
  approvalUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  providerError?: { code: string; httpStatus?: number; debugId?: string };
  checkNeeded: boolean;
  /** Read-model warning; successful command history stays immutable. */
  providerChange?: boolean;
  reconcileAttempts: number;
  expiresAt?: string;
}
export interface BuyerPayment {
  orderOperationId?: string;
  authorizationOperationId?: string;
  captureOperationId?: string;
  voidOperationId?: string;
  refundOperationId?: string;
}
export type PlanStatus = 'draft' | 'sent' | 'invalidated' | 'capturing' | 'reconciling' | 'paid' | 'failed';
export interface AllocationPlan {
  contractVersion?: 2;
  id: string;
  version: number;
  status: PlanStatus;
  assignments: Assignment[];
  consents: Partial<Record<BuyerId, Consent>>;
  payments: Partial<Record<BuyerId, BuyerPayment>>;
  createdAt: string;
  sentAt?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  failureReason?: string;
}
export interface NoSolution {
  code: 'BUYER_COUNT' | 'MISSING_PREFERENCES' | 'INSUFFICIENT_BUDGET' | 'NO_ALLOCATION' | 'INCOMPLETE';
  message: string;
  activeBuyerCount: number;
  requiredBuyerCount: number;
  totalCents: number;
  limitsTotalCents: number;
  shortfallCents: number;
  unassignedItemIds: string[];
}
export interface SessionUser { id: UserId; name: string; email: string; role: Role }
export interface Progress {
  activeBuyers: number;
  requiredBuyers: number;
  preferences: number;
  agreements: number;
  authorizations: number;
  captures: number;
}
export interface ActionGate { allowed: boolean; reason?: string }
export interface Gates {
  confirmCatalog: ActionGate;
  solve: ActionGate;
  sendPlan: ActionGate;
  agree: ActionGate;
  authorize: ActionGate;
  capture: ActionGate;
  packing: ActionGate;
  editPreferences: ActionGate;
  withdraw: ActionGate;
}
export interface PaymentView {
  order?: PaymentOperation;
  authorization?: PaymentOperation;
  capture?: PaymentOperation;
  void?: PaymentOperation;
  refund?: PaymentOperation;
}
export interface PlanAssignmentView extends Assignment {
  buyerName: string;
  budgetCents: number;
  consent?: Consent;
  payment: PaymentView;
  previous?: { itemIds: string[]; totalCents: number; payment?: PaymentView };
}
export interface OrganizerPlanView {
  id: string;
  version: number;
  status: PlanStatus;
  assignments: PlanAssignmentView[];
  createdAt: string;
  sentAt?: string;
  failureReason?: string;
  invalidationReason?: string;
}
export interface PriorPlanPaymentBlocker {
  planId: string;
  planVersion: number;
  buyerId: BuyerId;
  buyerName: string;
  operations: PaymentOperation[];
}
export interface BuyerPlanView {
  id: string;
  version: number;
  status: PlanStatus;
  assignment: Assignment;
  consent?: Consent;
  payment: PaymentView;
  previous?: { itemIds: string[]; totalCents: number; payment?: PaymentView };
  failureReason?: string;
  invalidationReason?: string;
}
export interface PackingPackage {
  buyerId: BuyerId;
  buyerName: string;
  address: DeliveryAddress;
  itemIds: string[];
  totalCents: number;
  checkedItemIds: string[];
  packedAt?: string;
  shippedAt?: string;
}
export type RehearsalScenario = 'start' | 'collecting' | 'plan' | 'agreements' | 'three-authorizations' | 'ready' | 'success' | 'unknown' | 'partial-failure' | 'refund-completed' | 'dropout' | 'v2' | 'incomplete' | 'expired' | 'hold-unknown';
export interface DemoAccess { name: string; role: Role; inviteToken: string }
export interface AnonymousView {
  conceptVersion?: 2;
  authenticated: false;
  mode: AppMode;
  rehearsalCollectionId?: DemoCollectionId;
  demoAccess: DemoAccess[];
  paymentConfigured: boolean;
  aiConfigured: boolean;
}
export interface ViewBase {
  conceptVersion?: 2;
  paymentDeadline?: string;
  demoAccess?: DemoAccess[];
  authenticated: true;
  mode: AppMode;
  rehearsalCollectionId?: DemoCollectionId;
  me: SessionUser;
  revision: number;
  progress: Progress;
  gates: Gates;
  reservationExpired: boolean;
  paymentConfigured: boolean;
  aiConfigured: boolean;
  simulationNotice?: string;
}
export interface OrganizerView extends ViewBase {
  planCheck?: { status:'complete'|'blocked'|'waiting'|'incomplete'|'closed'; unassignedItemIds:string[] };
  previousPlan?: { id:string; version:number; buyers:{buyerId:BuyerId;name:string;amountCents:number;payment:PaymentView}[] };
  agentQuestion?: CheckedQuestion;
  role: 'organizer';
  collection: Collection;
  participants: Participant[];
  plan?: OrganizerPlanView;
  priorPaymentBlockers: PriorPlanPaymentBlocker[];
  noSolution?: NoSolution;
  invitations: { buyerId: BuyerId; name: string; url: string; active: boolean }[];
  packing: PackingPackage[];
  rehearsalCaptureOutcome: 'success' | 'unknown-ola' | 'failure-ola';
}
export interface BuyerView extends ViewBase {
  agentQuestion?: CheckedQuestion;
  role: 'buyer';
  collection: PublicCollection;
  participant: Participant;
  plan?: BuyerPlanView;
  noSolution?: { message: string };
  shipment?: { packedAt?: string; shippedAt?: string };
  demoDefaults: { preferredItemIds: string[]; alternativeItemIds: string[]; budgetCents: number };
}
export type AppView = AnonymousView | OrganizerView | BuyerView;
export interface CheckedQuestion {
  id: string;
  buyerId: BuyerId;
  buyerName: string;
  itemIds: string[];
  amountCents: number;
  question: string;
  reason: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined';
  contextDigest: string;
  source: 'nebius' | 'rehearsal';
  checked: true;
  toolCalls: { name: string; summary: string }[];
  model?: string;
  createdAt: string;
}
export interface ApiResult { state: AppView; approvalUrl?: string; operationId?: string; link?: string; photoUrl?:string; message?: string }
export interface ApiError { error: string; code: string; fields?: Record<string, string> }

/** Route contract: every mutation returns ApiResult, GET /api/state returns AppView.
 * POST /api/auth/demo {inviteToken,collectionId?}; optional collectionId resets the example, for demo-kasia only.
 * POST /api/auth/request-link {email,inviteToken?};
 * GET /api/auth/consume?token=...; POST /api/auth/logout.
 * PATCH /api/collection {name?,description?,collectionPriceCents?,sharedCostCents?,photos?};
 * PATCH /api/items/:id {name?,description?,condition?,imageUrl?,shareCents?,confirmed?};
 * POST /api/catalog/confirm; POST /api/invitations {buyerId};
 * PUT /api/preferences {preferredItemIds,budgetCents};
 * PUT /api/preferences/alternatives {alternativeItemIds,confirmed:true};
 * POST /api/plan/solve; POST /api/plan/send {planId};
 * POST /api/plan/agree {planId,termsDigest}; POST /api/participants/withdraw;
 * POST /api/participants/replace {leavingBuyerId:'jan',replacementBuyerId:'ewa'};
 * PUT /api/address DeliveryAddress; POST /api/payments/authorize {planId};
 * POST /api/payments/approve {operationId}; POST /api/payments/capture {planId};
 * POST /api/payments/reconcile {operationId?};
 * POST /api/payments/retry-compensation {operationId};
 * PUT /api/packing/:buyerId {checkedItemIds?,packed?,shipped?};
 * POST /api/rehearsal/scenario {scenario};
 * POST /api/rehearsal/collection {collectionId}; resets the whole example, organizer/rehearsal only.
 * POST /api/rehearsal/outcome {outcome:'success'|'unknown-ola'|'failure-ola'}.
 */
