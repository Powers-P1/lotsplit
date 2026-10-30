import { useEffect, useState } from 'react';
import { ArrowRight, Box, CalendarDays, Camera, Check, Info, LockKeyhole, PackageCheck, ShieldCheck, Sparkles, Truck } from 'lucide-react';
import type { BuyerView, DeliveryAddress, PublicItem } from '../shared/types';
import type { Mutate } from './api';
import { request } from './api';
import { Button, ConfirmDialog, CostRows, GateNote, ItemGrid, ItemImage, LinkButton, money, dateTime, Notice, PageHeading, ProgressBar, Status, itemLabel, displayCondition } from './components';

type BuyerProps = { state: BuyerView; route: string; navigate: (route: string) => void; mutate: Mutate; busy: boolean; refresh: () => Promise<void> };
const byIds = (items: PublicItem[], ids: string[]) => ids.flatMap(id => items.find(item => item.id === id) || []);
type SelectionDraft = { source: string; preferredIds: string[]; budget: string };
const collectionDraftScope = (state: BuyerView) => {
  const collectionId = state.rehearsalCollectionId || state.collection.id;
  const generation = state.mode === 'rehearsal' ? `:${state.collection.reservationExpiresAt}` : '';
  return `${state.mode}:${collectionId}${generation}:${state.me.id}`;
};
const draftKey = (state: BuyerView) => `lotsplit-selection-v1:${collectionDraftScope(state)}`;
const proposalKey = (state: BuyerView) => `lotsplit-alternatives-proposal:${collectionDraftScope(state)}`;
const draftSource = (state: BuyerView) => `${state.collection.catalogVersion}:${state.participant.preferences?.updatedAt || 'new'}`;
function selectionDraft(state: BuyerView): SelectionDraft | undefined {
  try { const draft = JSON.parse(sessionStorage.getItem(draftKey(state)) || 'null') as SelectionDraft | null; return draft?.source === draftSource(state) && Array.isArray(draft.preferredIds) ? draft : undefined; } catch { return undefined; }
}

export function buyerHome(state: BuyerView) {
  if (!state.participant.active) return '/withdrawn';
  if (state.plan && state.plan.status !== 'draft') {
    if (state.plan.status === 'invalidated') return '/plan';
    if (state.plan.payment.authorization || state.plan.payment.capture || state.plan.payment.refund || state.plan.payment.void) return '/payment';
    if (state.plan.consent && state.progress.agreements === state.progress.requiredBuyers) return '/delivery';
    return '/plan';
  }
  return state.participant.preferences?.submittedAt ? '/saved' : '/collection';
}

export default function BuyerFlow(props: BuyerProps) {
  const route = props.route === '/' ? buyerHome(props.state) : props.route;
  const { state, navigate } = props;
  const [withdraw, setWithdraw] = useState(false);
  const itemId = route.startsWith('/item/') ? route.split('/')[2].split('?')[0] : undefined;
  const item = state.collection.items.find(value => value.id === itemId);
  let screen;
  if (item) screen = <ItemDetail {...props} item={item} />;
  else if (route === '/selection') screen = <Selection {...props} />;
  else if (route === '/alternatives') screen = <Alternatives {...props} />;
  else if (route === '/saved') screen = <Saved {...props} />;
  else if (route === '/plan') screen = <BuyerPlan {...props} onWithdraw={() => setWithdraw(true)} />;
  else if (route === '/delivery') screen = <Delivery {...props} />;
  else if (route === '/payment-approval') screen = <RehearsalApproval {...props} />;
  else if (route === '/payment') screen = <BuyerPayment {...props} />;
  else if (route === '/withdrawn') screen = <><PageHeading title="You have withdrawn" subtitle={state.collection.name} /><Notice>The organizer has been notified that you withdrew. Your previous allocation will not go ahead.</Notice><LinkButton onClick={() => navigate('/collection')}>View bundle</LinkButton></>;
  else screen = <BuyerCollection {...props} />;
  return <main className="buyer-main" id="main-content">{screen}{withdraw ? <ConfirmDialog title="Withdraw from this purchase?" confirmLabel="Withdraw from purchase" busy={props.busy} onCancel={() => setWithdraw(false)} onConfirm={async () => { const result = await props.mutate('/participants/withdraw', { revision: state.revision }); if (result) { setWithdraw(false); navigate('/withdrawn'); } }}><p>The current plan will become invalid. The organizer will prepare a new allocation for the remaining participants.</p><p>Any payment authorization will be shown separately.</p></ConfirmDialog> : null}</main>;
}

function BuyerCollection({ state, navigate }: BuyerProps) {
  const collection = state.collection;
  const preview = byIds(collection.items, state.participant.preferences?.preferredItemIds.length ? state.participant.preferences.preferredItemIds : state.demoDefaults.preferredItemIds);
  const [all, setAll] = useState(false);
  return <>
    <PageHeading title={collection.name} subtitle="Organized by Kasia" />
    <p className="section-description">{collection.items.length} {itemLabel(collection.items.length)} in this bundle</p>
    <ItemGrid items={all ? collection.items : preview.length ? preview : collection.items.slice(0, 6)} onDetail={id => navigate(`/item/${id}`)} allSelected />
    {!all && collection.items.length > 6 ? <LinkButton onClick={() => setAll(true)}>View full bundle</LinkButton> : null}
    <CostRows rows={[{ label: 'Bundle', cents: collection.collectionPriceCents }, { label: 'Handling and delivery', cents: collection.sharedCostCents }]} total={{ label: 'Total purchase', cents: collection.totalCents }} />
    <p className="icon-copy reservation"><CalendarDays size={21} />Reserved until {dateTime(collection.reservationExpiresAt)}</p>
    {state.reservationExpired ? <Notice tone="warning">The reservation has expired. New payment authorizations and charges are on hold.</Notice> : null}
    {state.plan && state.plan.status !== 'draft' ? <Button onClick={() => navigate(buyerHome(state))}>View your plan</Button> : <><Button onClick={() => navigate('/selection')} disabled={!state.gates.editPreferences.allowed}>Choose your items</Button><GateNote gate={state.gates.editPreferences} /></>}
    <p className="caption centered">You will see and approve the exact price in your plan.</p>
  </>;
}

function Selection({ state, navigate, mutate, busy }: BuyerProps) {
  const saved = state.participant.preferences;
  const [selected, setSelected] = useState<string[]>(() => selectionDraft(state)?.preferredIds || (saved?.preferredItemIds.length ? saved.preferredItemIds : state.mode === 'rehearsal' ? state.demoDefaults.preferredItemIds : []));
  const [budget, setBudget] = useState(() => selectionDraft(state)?.budget || String((saved?.budgetCents || (state.mode === 'rehearsal' ? state.demoDefaults.budgetCents : 0)) / 100 || ''));
  const [all, setAll] = useState(selected.length === 0);
  const [validation, setValidation] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSource, setAiSource] = useState<'nebius' | 'rehearsal'>();
  const [proposal, setProposal] = useState<{ preferredIds: string[]; alternativeIds: string[]; maxTotalCents?: number | null; ambiguities?: string[] }>();
  const storageKey = draftKey(state);
  const source = draftSource(state);
  useEffect(() => { sessionStorage.setItem(storageKey, JSON.stringify({ source, preferredIds: selected, budget })); }, [selected, budget, storageKey, source]);
  const items = all ? state.collection.items : byIds(state.collection.items, selected);
  const toggle = (id: string) => {
    setValidation('');
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < state.collection.itemsPerBuyer ? [...current, id] : (setValidation(`Choose exactly ${state.collection.itemsPerBuyer} items. Remove one of your selected items first.`), current));
  };
  const save = async () => {
    const cents = Math.round(Number(budget.replace(',', '.')) * 100);
    if (selected.length !== state.collection.itemsPerBuyer) { setValidation(`Choose ${state.collection.itemsPerBuyer} items to continue.`); return; }
    if (!Number.isSafeInteger(cents) || cents <= 0) { setValidation('Enter a maximum total spend greater than zero.'); return; }
    const result = await mutate('/preferences', { preferredItemIds: selected, budgetCents: cents, revision: state.revision }, 'PUT');
    if (result) navigate('/alternatives');
  };
  return <>
    <PageHeading title="Choose your items" subtitle={<span className="selection-meta"><span>{state.collection.name} · {state.collection.items.length} items</span><span>{selected.length} selected</span></span>} />
    <ItemGrid items={items} selectedIds={selected} onToggle={toggle} onDetail={id => navigate(`/item/${id}?from=selection`)} />
    <LinkButton onClick={() => setAll(value => !value)}>{all && selected.length ? 'Show selected items' : 'View full bundle'}</LinkButton>
    <div className="budget-section"><h2>Maximum total spend</h2><p className="muted">Including delivery and handling</p><div className="money-input"><input inputMode="decimal" value={budget} onChange={event => setBudget(event.target.value)} aria-label="Maximum total spend in PLN" /><span>PLN</span></div><p className="caption">This is your spending limit, not the price.</p></div>
    {validation ? <Notice tone="error">{validation}</Notice> : null}
    <Button onClick={save} busy={busy} disabled={!state.gates.editPreferences.allowed}>Save selection and limit</Button>
    <p className="caption centered">No payment is taken at this stage.</p><GateNote gate={state.gates.editPreferences} />
    {state.aiConfigured ? <div className="ai-assist"><LinkButton onClick={() => setAiOpen(value => !value)}><Sparkles size={15} />Help me enter my preferences</LinkButton>{aiOpen ? <div className="inline-form"><label>Describe the items you want<textarea value={aiText} onChange={event => setAiText(event.target.value)} placeholder="I want #01, #04… My total spending limit is 200 PLN." rows={3} /></label><Button variant="secondary" busy={aiBusy} disabled={!aiText.trim()} onClick={async () => { setAiBusy(true); setValidation(''); try { const result = await request<{ source: 'nebius' | 'rehearsal'; proposal: NonNullable<typeof proposal> }>('/ai/preferences', 'POST', { text: aiText }); setProposal(result.proposal); setAiSource(result.source); } catch (error) { setValidation(error instanceof Error ? error.message : 'We could not read your preferences.'); } finally { setAiBusy(false); } }}>Read preferences</Button>{proposal ? <div className="proposal"><h3>Review suggestion</h3><p className="caption">{aiSource === 'nebius' ? 'Suggestion generated by Nebius AI.' : 'Demo suggestion — your description was not processed by AI.'}</p><p>Selected items: {proposal.preferredIds.map(id => `#${id}`).join(', ') || 'not identified'}</p><p>Alternatives: {proposal.alternativeIds.map(id => `#${id}`).join(', ') || 'not identified'}</p><p>Limit: {proposal.maxTotalCents ? money(proposal.maxTotalCents) : 'not identified'}</p>{proposal.ambiguities?.map(message => <p className="caption" key={message}>{message}</p>)}<Button variant="secondary" onClick={() => { setSelected(proposal.preferredIds); if (proposal.maxTotalCents) setBudget(String(proposal.maxTotalCents / 100)); sessionStorage.setItem(proposalKey(state), JSON.stringify(proposal.alternativeIds)); setProposal(undefined); setAiOpen(false); setAll(false); }}>Use these details</Button><p className="caption">Review these details before saving. You will confirm alternatives separately.</p></div> : null}</div> : null}</div> : null}
  </>;
}

function Alternatives({ state, navigate, mutate, busy }: BuyerProps) {
  const preferences = state.participant.preferences;
  const preferred = preferences?.preferredItemIds || [];
  const alternativeDraftKey = `lotsplit-alternatives-v1:${collectionDraftScope(state)}`;
  const [selected, setSelected] = useState<string[]>(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(alternativeDraftKey) || 'null');
      if (draft?.source === draftSource(state) && Array.isArray(draft.ids)) return draft.ids;
      const proposed = JSON.parse(sessionStorage.getItem(proposalKey(state)) || 'null');
      if (Array.isArray(proposed)) return proposed.filter(id => !preferred.includes(id) && state.collection.items.some(item => item.id === id));
    } catch { /* use the last server-confirmed input */ }
    if (preferences?.alternativesConfirmed) return preferences.alternativeItemIds;
    return preferences?.alternativeItemIds.length ? preferences.alternativeItemIds : state.mode === 'rehearsal' ? state.demoDefaults.alternativeItemIds : [];
  });
  const source = draftSource(state);
  useEffect(() => { sessionStorage.setItem(alternativeDraftKey, JSON.stringify({ source, ids: selected })); }, [selected, alternativeDraftKey, source]);
  const [all, setAll] = useState(false);
  const candidates = state.collection.items.filter(item => !preferred.includes(item.id));
  const suggested = [...new Set([...state.demoDefaults.alternativeItemIds, ...candidates.filter(item => Number(item.id) >= 20).map(item => item.id), ...candidates.map(item => item.id)])].slice(0, 3);
  const save = async (ids: string[]) => { const result = await mutate('/preferences/alternatives', { alternativeItemIds: ids, confirmed: true, revision: state.revision }, 'PUT'); if (result) { sessionStorage.removeItem(proposalKey(state)); sessionStorage.removeItem(alternativeDraftKey); navigate('/saved'); } };
  return <>
    <PageHeading title="Accepted alternatives" subtitle={`${preferred.length} first-choice items · limit ${money(preferences?.budgetCents || 0)}`} />
    <p className="section-description">Choose other items you would accept as replacements.</p>
    <ItemGrid items={all ? candidates : byIds(candidates, suggested)} selectedIds={selected} onToggle={id => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])} onDetail={id => navigate(`/item/${id}?from=alternatives`)} />
    <LinkButton onClick={() => setAll(value => !value)}>{all ? 'Show fewer' : 'View remaining items'}</LinkButton>
    <p className="alternative-count">{selected.length ? <>{selected.length} {selected.length === 1 ? 'accepted alternative' : 'accepted alternatives'}: <strong>{selected.map(id => `#${id}`).join(', ')}</strong></> : 'No alternatives selected.'}</p>
    <div className="divider-copy"><p>You will approve every replacement and the final price in your plan.</p><p className="caption">Items you leave unselected will not be assigned to you.</p></div>
    <Button onClick={() => save(selected)} busy={busy} disabled={selected.length === 0}>Save alternatives</Button>
    <Button variant="text" onClick={() => save([])} busy={busy}>I do not accept alternatives</Button>
    <LinkButton className="centered-link" onClick={() => navigate('/selection')}>Back to selection and limit</LinkButton>
  </>;
}

function Saved({ state, navigate }: BuyerProps) {
  const preferences = state.participant.preferences;
  const selected = byIds(state.collection.items, preferences?.preferredItemIds || []);
  return <>
    <PageHeading title="Selection saved" subtitle={state.collection.name} />
    <div className="saved-art">{selected.slice(0, 2).map(item => <ItemImage key={item.id} src={item.imageUrl} alt={item.name} />)}</div>
    <div className="summary-line"><Box size={27} strokeWidth={1.5} /><div><strong>{selected.length} items</strong><p className="muted">Your selection from Kasia’s bundle</p></div></div>
    <div className="summary-line"><LockKeyhole size={27} strokeWidth={1.5} /><div><strong>Your spending limit</strong><p className="muted">For this bundle</p></div><strong className="summary-amount">{money(preferences?.budgetCents || 0)}</strong></div>
    {state.plan && state.plan.status !== 'draft' ? <div className="success-message"><span className="success-symbol"><Check size={33} /></span><h2>Your plan is ready.</h2><p>Review your exact allocation and price.</p><Button onClick={() => navigate('/plan')}>View plan</Button></div> : <div className="success-message"><span className="success-symbol"><Check size={33} /></span><h2>Kasia will prepare a proposed allocation.</h2><p>You will approve the exact price in your plan.<br />No payment has been taken.</p></div>}
    <Button variant={state.plan && state.plan.status !== 'draft' ? 'secondary' : 'primary'} onClick={() => navigate('/collection')}>Back to bundle</Button>
    <LinkButton className="centered-link" onClick={() => navigate('/selection')} disabled={!state.gates.editPreferences.allowed}>Edit selection and limit</LinkButton>
  </>;
}

function BuyerPlan({ state, navigate, mutate, busy, onWithdraw }: BuyerProps & { onWithdraw: () => void }) {
  const plan = state.plan;
  if (!plan || plan.status === 'draft') return <Saved {...{ state, navigate, mutate, busy, route: '/saved', refresh: async () => {} }} />;
  if (plan.status === 'invalidated') return <><PageHeading title="The plan needs updating" subtitle={`${state.collection.name} · Plan ${plan.version}`} /><Notice tone="warning">{plan.invalidationReason || state.noSolution?.message || 'The group or bundle terms have changed. Kasia will prepare a new proposal.'}</Notice><p className="section-description">Your previous approval does not authorize a new payment hold or charge.</p><Button onClick={() => navigate('/collection')}>Back to bundle</Button></>;
  const assignment = plan.assignment;
  const items = byIds(state.collection.items, assignment.itemIds);
  const previous = plan.previous;
  const changed = previous && (previous.totalCents !== assignment.totalCents || previous.itemIds.join() !== assignment.itemIds.join());
  const added = previous ? assignment.itemIds.filter(id => !previous.itemIds.includes(id)) : [];
  const removed = previous ? previous.itemIds.filter(id => !assignment.itemIds.includes(id)) : [];
  const accepted = !!plan.consent;
  return <>
    <PageHeading title={accepted ? 'Plan approved' : changed ? 'Your plan has changed' : 'Your allocation'} subtitle={accepted ? `${items.length} items · ${money(assignment.totalCents)}` : `Plan ${plan.version} · ${state.collection.name}`} />
    {changed && !accepted ? <><h2>New allocation</h2><p className="ids-line">{assignment.itemIds.map(id => `#${id}`).join(', ')}</p><div className="change-table"><div><strong>Items</strong><span>{removed.map(id => `#${id}`).join(', ')} <ArrowRight size={16} /> {added.map(id => `#${id}`).join(', ')}</span></div><div><strong>Price</strong><span>{money(previous.totalCents)} <ArrowRight size={16} /> {money(assignment.totalCents)}</span></div><div><strong>Item count</strong><span>{items.length} — unchanged</span></div><div><strong>Your spending limit</strong><span>{money(state.participant.preferences?.budgetCents || 0)}</span></div></div><Notice>Your previous approval does not cover these changes.</Notice></> : null}
    {accepted ? <p className="section-description">{state.progress.agreements < state.progress.requiredBuyers ? 'Waiting for the other participants to approve.' : 'Everyone has approved the plan. You can now authorize your payment.'}</p> : !changed ? <h2 className="item-section-heading">Items in your plan ({items.length})</h2> : null}
    <ItemGrid items={items} allSelected={!accepted} onDetail={id => navigate(`/item/${id}?from=plan`)} highlightIds={!accepted ? added : []} />
    {!accepted ? <>
      <CostRows rows={[{ label: `${items.length} items`, cents: assignment.baseCents }, { label: 'Handling and delivery', cents: assignment.sharedCostCents }]} total={{ label: 'Total', cents: assignment.totalCents }} />
      <div className="budget-summary"><span>Your spending limit</span><strong>{money(state.participant.preferences?.budgetCents || 0)}</strong></div>
      <Button busy={busy} disabled={!state.gates.agree.allowed} onClick={async () => { const result = await mutate('/plan/agree', { planId: plan.id, termsDigest: assignment.termsDigest, revision: state.revision }); if (result) navigate('/plan'); }}>{changed ? 'Approve updated plan' : 'Approve plan'} for {money(assignment.totalCents)}</Button>
      <p className="caption centered">This approves the allocation. No payment is taken.</p><GateNote gate={state.gates.agree} />
      <Button variant="text" disabled={!state.gates.withdraw.allowed} onClick={onWithdraw}>{changed ? 'Decline changes' : 'Decline plan'}</Button>
    </> : <>
      <div className="agreement-progress"><span className="muted">Approvals</span><strong>{state.progress.agreements} of {state.progress.requiredBuyers}</strong></div>
      <p className="icon-copy muted"><Info size={20} />No payment has been authorized or charged.</p>
      {state.progress.agreements === state.progress.requiredBuyers ? <Button onClick={() => navigate('/delivery')}>Continue to authorization</Button> : <Button onClick={() => navigate('/collection')}>Back to bundle</Button>}
      <LinkButton className="centered-link" onClick={onWithdraw} disabled={!state.gates.withdraw.allowed}>Withdraw from purchase</LinkButton>
    </>}
  </>;
}

function Delivery({ state, navigate, mutate, busy }: BuyerProps) {
  const plan = state.plan;
  const [address, setAddress] = useState<DeliveryAddress>(state.participant.address || { recipient: '', street: '', postalCode: '', city: '', country: 'PL' });
  const [validation, setValidation] = useState('');
  if (!plan) return <Notice>Approve your plan first.</Notice>;
  const assignment = plan.assignment;
  const submit = async () => {
    if (!address.recipient.trim() || !address.street.trim() || !address.city.trim() || !/^\d{2}-\d{3}$/.test(address.postalCode)) { setValidation('Complete your address and enter a postal code in the format 00-000.'); return; }
    const saved = await mutate('/address', { ...address, revision: state.revision }, 'PUT');
    if (!saved) return;
    const revision = saved.state.authenticated ? saved.state.revision : state.revision;
    const result = await mutate('/payments/authorize', { planId: plan.id, revision });
    if (!result) return;
    if (result.approvalUrl) {
      if (state.mode === 'rehearsal') navigate('/payment-approval');
      else window.location.assign(result.approvalUrl);
    } else navigate('/payment');
  };
  const update = (field: keyof DeliveryAddress, value: string) => setAddress(current => ({ ...current, [field]: value }));
  return <>
    <PageHeading title="Delivery and payment" subtitle={`Plan ${plan.version} · Your total ${money(assignment.totalCents)}`} />
    <ItemGrid items={byIds(state.collection.items, assignment.itemIds)} compact onDetail={id => navigate(`/item/${id}?from=delivery`)} />
    <section className="form-section"><h2>Delivery details</h2><p className="muted">These details will be shared with the organizer after payment is complete.</p><div className="form-fields"><label>Full name<input autoComplete="name" value={address.recipient} onChange={event => update('recipient', event.target.value)} /></label><label>Street and number<input autoComplete="street-address" value={address.street} onChange={event => update('street', event.target.value)} /></label><div className="form-two-col"><label>Postal code<input autoComplete="postal-code" placeholder="00-000" maxLength={6} value={address.postalCode} onChange={event => update('postalCode', event.target.value)} /></label><label>City<input autoComplete="address-level2" value={address.city} onChange={event => update('city', event.target.value)} /></label></div></div></section>
    <section className="form-section"><h2>Delivery</h2><div className="delivery-method"><Truck size={24} />Delivery arranged by the organizer</div></section>
    <section className="form-section"><h2>Payment</h2><Notice><LockKeyhole size={21} />PayPal will place a hold on {money(assignment.totalCents)}. You will be charged when everyone is ready.</Notice></section>
    {validation ? <Notice tone="error">{validation}</Notice> : null}
    {!state.paymentConfigured && state.mode === 'sandbox' ? <Notice tone="warning">The organizer needs to configure the PayPal sandbox connection.</Notice> : null}
    <Button onClick={submit} busy={busy} disabled={!state.gates.authorize.allowed && state.gates.authorize.reason !== 'Add your delivery address.'}>Authorize {money(assignment.totalCents)} with PayPal</Button>
    <GateNote gate={state.gates.authorize} fallback={state.mode === 'sandbox' ? 'You will continue to PayPal sandbox.' : 'You will continue to a simulated authorization in the offline demo.'} />
  </>;
}

function RehearsalApproval({ state, navigate, mutate, busy }: BuyerProps) {
  const order = state.plan?.payment.order;
  if (state.mode !== 'rehearsal') return <Notice>Complete your authorization in PayPal sandbox.</Notice>;
  if (!order || !state.plan) return <><Notice>No authorization has been started.</Notice><Button onClick={() => navigate('/delivery')}>Back to delivery and payment</Button></>;
  return <>
    <PageHeading title="Confirm authorization" subtitle="Offline demo — simulated payments" />
    <div className="authorization-symbol"><LockKeyhole size={34} strokeWidth={1.5} /></div>
    <p className="payment-large">{money(order.amountCents)}</p>
    <p className="section-description">This simulates approval for a payment hold. No real money will be charged.</p>
    <Notice>In sandbox mode, this step takes place on PayPal.</Notice>
    <Button busy={busy} onClick={async () => { const result = await mutate('/payments/approve', { operationId: order.id, outcome: 'approve' }); if (result) navigate('/payment'); }}>Confirm simulated authorization</Button>
    <Button variant="text" busy={busy} onClick={async () => { const result = await mutate('/payments/cancel', { operationId: order.id }); if (result) navigate('/payment'); }}>Cancel authorization</Button>
  </>;
}

function BuyerPayment({ state, navigate, mutate, busy, refresh }: BuyerProps) {
  const plan = state.plan;
  if (!plan) return <Notice>The current plan is not available yet.</Notice>;
  const { payment, assignment } = plan;
  const amount = assignment.totalCents;
  const items = byIds(state.collection.items, assignment.itemIds);
  const refreshOperation = () => mutate('/payments/reconcile', { operationId: payment.refund?.id || payment.capture?.id || payment.authorization?.id || payment.order?.id });
  if (payment.refund) {
    const completed = payment.refund.status === 'COMPLETED';
    const failed = payment.refund.status === 'FAILED';
    return <><PageHeading title={completed ? 'Refund confirmed' : failed ? 'Refund needs review' : 'Refund in progress'} /><p className="payment-large">{money(payment.refund.amountCents)}</p><p className="section-description">{completed ? `PayPal has confirmed your refund of ${money(payment.refund.amountCents)}.` : failed ? 'The refund attempt failed. The purchase remains on hold.' : 'The purchase did not go ahead. A refund has been requested through PayPal.'}</p><Notice tone={completed ? 'success' : failed ? 'error' : 'warning'}><strong>{completed ? 'Refund completed in PayPal' : failed ? 'Refund failure confirmed' : 'Waiting for confirmation'}</strong><p>{completed ? 'When the funds become available depends on your payment method and bank.' : failed ? 'Kasia can see the error and retry the refund after reviewing the transaction. Do not start a new payment.' : 'Your refund is being processed. Packing remains blocked.'}</p></Notice><h2>{state.collection.name} · Plan {plan.version}</h2><p className="muted item-count-copy">{items.length} items · {money(amount)}</p><ItemGrid items={items} onDetail={id => navigate(`/item/${id}?from=payment`)} />{!completed ? <Button busy={busy} onClick={failed ? () => void refresh() : refreshOperation}>{failed ? 'Refresh payment details' : 'Check refund status'}</Button> : <Button variant="secondary" onClick={() => navigate('/collection')}>Back to bundle</Button>}</>;
  }
  if (plan.status === 'failed') return <><PageHeading title="Purchase on hold" subtitle={`Plan ${plan.version}`} /><Notice tone="warning">The group purchase did not go ahead. Fulfillment is blocked.</Notice><p className="payment-large">{money(amount)}</p><Status status={payment.void?.status || payment.authorization?.status} kind={payment.void ? 'void' : 'authorization'} /><p className="section-description">{payment.void?.status === 'VOIDED' ? 'PayPal has confirmed that your payment hold was released.' : 'We are checking your authorization status. Do not start a new payment.'}</p><Button busy={busy} onClick={refreshOperation}>Check payment details</Button></>;
  if (plan.status === 'paid' && payment.capture?.status === 'COMPLETED') return <><PageHeading title="Your allocation is paid" /><div className="paid-amount"><span className="success-symbol"><Check size={35} /></span><div><p className="muted">Charged</p><strong>{money(amount)}</strong></div></div><p className="section-description">{state.shipment?.shippedAt ? 'Kasia has marked your parcel as shipped.' : state.shipment?.packedAt ? 'Your items are packed.' : 'Kasia will prepare your items for delivery.'}</p><div className="divider-copy"><h2>{items.length} items · delivery and handling included</h2></div><ItemGrid items={items} onDetail={id => navigate(`/item/${id}?from=payment`)} /><div className="summary-line"><PackageCheck size={25} /><strong>{state.shipment?.shippedAt ? 'Shipped' : state.shipment?.packedAt ? 'Packed' : 'Awaiting packing'}</strong></div>{state.participant.address ? <div className="delivery-address"><strong>Delivery address</strong><p>{state.participant.address.recipient}<br />{state.participant.address.street}<br />{state.participant.address.postalCode} {state.participant.address.city}</p></div> : null}<Button variant="secondary" onClick={() => navigate('/collection')}>Back to bundle</Button></>;
  if (payment.capture?.status === 'UNKNOWN' || payment.capture?.status === 'PENDING' || plan.status === 'reconciling' || plan.status === 'capturing') return <><PageHeading title="Confirming payments" subtitle={`Plan ${plan.version}`} /><p className="payment-large">{money(amount)}</p><Notice tone="warning">{payment.capture?.status === 'COMPLETED' ? 'Your payment has been charged. Waiting for all group payments to be confirmed.' : 'We are checking the existing PayPal transaction. Do not submit another payment.'}</Notice><ProgressBar value={state.progress.captures} total={state.progress.requiredBuyers} label="Confirmed payments" /><p className="section-description">Packing will begin once all charges are confirmed.</p><Button busy={busy} onClick={refreshOperation}>Check status</Button></>;
  const authorized = payment.authorization?.status === 'AUTHORIZED';
  if (authorized) return <><PageHeading title="Payment authorized" /><p className="payment-large green">{money(amount)}</p><p className="section-description">No payment has been charged yet.</p><div className="divider-copy"><ProgressBar value={state.progress.authorizations} total={state.progress.requiredBuyers} label="Authorizations" /><p className="muted">{state.progress.authorizations === state.progress.requiredBuyers ? 'Everyone is ready. Waiting for Kasia to collect the payments.' : 'Waiting for the other participants to authorize their payments.'}</p></div><div className="own-authorization"><div><strong>Your authorization</strong><p>{money(amount)} · Plan {plan.version}</p></div><Status status="AUTHORIZED" /></div><Notice>PayPal may hold this amount until it is charged or the authorization is canceled.</Notice><Button variant="secondary" onClick={() => navigate('/collection')}>Back to purchase</Button></>;
  const failed = payment.order?.status === 'CANCELLED' || payment.order?.status === 'FAILED' || payment.authorization?.status === 'FAILED';
  const failedAuthorization = state.mode === 'sandbox' && payment.authorization?.status === 'FAILED';
  const uncertain = [payment.order?.status, payment.authorization?.status].some(value => value === 'UNKNOWN' || value === 'STARTED' || value === 'PENDING');
  return <><PageHeading title={uncertain ? 'Checking authorization' : failed ? 'Authorization incomplete' : 'Authorize your payment'} subtitle={`Plan ${plan.version} · ${money(amount)}`} /><Notice tone={failed || uncertain ? 'warning' : 'info'}>{uncertain ? 'The existing authorization is not confirmed yet. The button below checks PayPal and can finish the saved authorization if approval is confirmed.' : failedAuthorization ? 'PayPal has not confirmed this authorization. Check the existing order and retry its saved authorization if needed.' : payment.order?.status === 'CANCELLED' ? 'You canceled this authorization. The price in your plan is unchanged.' : failed ? 'The authorization request was not completed. Check the existing transaction before continuing.' : 'Save your delivery address, then confirm authorization in PayPal.'}</Notice>{uncertain ? <Button busy={busy} onClick={refreshOperation}>Check and retry existing authorization</Button> : failedAuthorization ? <Button busy={busy} disabled={!state.gates.authorize.allowed} onClick={() => mutate('/payments/retry-authorization', { operationId: payment.authorization!.id })}>Check and retry existing authorization</Button> : payment.order?.status === 'CREATED' ? <Button onClick={() => state.mode === 'rehearsal' ? navigate('/payment-approval') : payment.order?.approvalUrl && window.location.assign(payment.order.approvalUrl)}>Complete authorization</Button> : <Button disabled={!state.gates.authorize.allowed} onClick={() => navigate('/delivery')}>{failed ? 'Try again' : 'Delivery and authorization'}</Button>}<GateNote gate={state.gates.authorize} /><Button variant="text" onClick={() => void refresh()}>Refresh status</Button></>;
}

function ItemDetail({ state, item, route, navigate, mutate, busy }: BuyerProps & { item: PublicItem }) {
  const from = route.includes('from=') ? route.split('from=')[1] : 'collection';
  const selected = selectionDraft(state)?.preferredIds || state.participant.preferences?.preferredItemIds || (state.mode === 'rehearsal' ? state.demoDefaults.preferredItemIds : []);
  const isSelected = selected.includes(item.id);
  return <>
    <ItemImage className="detail-image" src={item.imageUrl} alt={item.name} loading="eager" />
    <PageHeading title={`Item #${item.id}`} subtitle={item.name} />
    <div className="detail-facts"><p className="icon-copy"><ShieldCheck size={25} />Condition: {displayCondition(item.condition)}</p><p className="icon-copy muted"><Camera size={24} />{item.confirmed ? 'Description and photo confirmed by Kasia.' : 'Description awaiting confirmation from the organizer.'}</p></div>
    <p className="detail-description">{item.description}</p>
    {isSelected ? <><Notice tone="success">This item is already in your selection.</Notice><Button onClick={() => navigate(`/${from}`)}>Back to {from === 'plan' ? 'plan' : from === 'alternatives' ? 'alternatives' : from === 'delivery' ? 'delivery' : from === 'payment' ? 'payment' : 'selection'}</Button></> : <><Button disabled={!state.gates.editPreferences.allowed || selected.length >= state.collection.itemsPerBuyer} onClick={() => { const draft = selectionDraft(state); sessionStorage.setItem(draftKey(state), JSON.stringify({ source: draftSource(state), preferredIds: [...selected, item.id], budget: draft?.budget || String((state.participant.preferences?.budgetCents || state.demoDefaults.budgetCents) / 100) })); navigate('/selection'); }}>Add to selection</Button>{selected.length >= state.collection.itemsPerBuyer ? <p className="caption centered">You have already selected {state.collection.itemsPerBuyer} items. Remove one to add this item.</p> : null}<LinkButton className="centered-link" onClick={() => navigate(`/${from}`)}>Back to {from === 'collection' ? 'bundle' : from === 'alternatives' ? 'alternatives' : from === 'plan' ? 'plan' : 'selection'}</LinkButton></>}
  </>;
}
