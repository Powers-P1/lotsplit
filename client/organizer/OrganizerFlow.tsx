import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ImagePlus, Printer, X } from 'lucide-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { CollectionItem, OrganizerView, PackingPackage, Participant, PlanAssignmentView, PublicItem } from '../../shared/types';
import type { Mutate } from '../api';
import { request } from '../api';
import { Button, CostRows, dateTime, displayCondition, GateNote, ItemGrid, ItemImage, itemLabel, LinkButton, money, Notice, PageHeading, Status } from '../components';
import FlatGrid from './FlatGrid';

export type OrganizerProps = { state: OrganizerView; route: string; navigate: (route: string) => void; mutate: Mutate; busy: boolean; refresh: () => Promise<void> };
const itemOrder = ['01', '04', '07', '09', '12', '18'];
const byIds = (items: PublicItem[], ids: string[]) => ids.flatMap(id => items.find(item => item.id === id) || []);
export function organizerHome(state: OrganizerView) {
  if (state.noSolution) return '/allocation';
  if (state.plan?.status === 'paid') return '/packing';
  if (state.plan && ['capturing', 'reconciling', 'failed'].includes(state.plan.status)) return '/payments';
  if (state.plan?.status === 'sent' && state.progress.agreements === state.progress.requiredBuyers) return '/payments';
  if (state.plan) return '/allocation';
  if (state.collection.preferencesOpened) return '/participants';
  return '/setup';
}

export default function OrganizerFlow(props: OrganizerProps) {
  const route = props.route === '/' ? organizerHome(props.state) : props.route;
  let content;
  if (route === '/catalog') content = <Catalog {...props} />;
  else if (route === '/participants') content = <Participants {...props} />;
  else if (route === '/allocation') content = <Allocation {...props} />;
  else if (route === '/payments') content = <Payments {...props} />;
  else if (route === '/packing') content = <Packing {...props} />;
  else content = <CollectionSetup {...props} />;
  return <main className="organizer-main" id="main-content">{content}</main>;
}

interface CatalogProposal { items: { id: string; name: string; description: string; observedCondition: string | null; uncertain: boolean; confidence: number; confirmed: false }[]; warnings?: string[]; requiresHumanConfirmation: true; }
async function imageDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:image/')) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read the bundle photo. Please upload it again.');
  const blob = await response.blob();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('Upload a PNG, JPG or WebP photo for AI analysis.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
}

function CollectionSetup({ state, navigate, mutate, busy }: OrganizerProps) {
  const collection = state.collection;
  const [name, setName] = useState(collection.name);
  const [price, setPrice] = useState(String(collection.collectionPriceCents / 100));
  const [cost, setCost] = useState(String(collection.sharedCostCents / 100));
  const [reservation, setReservation] = useState(() => { const date = new Date(collection.reservationExpiresAt); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [photos, setPhotos] = useState(collection.photos);
  const [uploadError, setUploadError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [proposal, setProposal] = useState<CatalogProposal>();
  const [proposalSource, setProposalSource] = useState<'nebius' | 'rehearsal'>();
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = collection.preferencesOpened;
  const total = Math.round((Number(price) + Number(cost)) * 100);
  const readFile = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setUploadError('Choose a PNG, JPG or WebP photo.'); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError('Photos must be 5 MB or smaller.'); return; }
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    setPhotos(current => [...current.filter(photo => !photo.startsWith('/assets/collection')), url]); setUploadError('');
  };
  const save = async (analyze: boolean) => {
    if (!name.trim() || !Number.isFinite(total) || total <= 0 || Number(price) <= 0 || Number(cost) < 0 || !reservation) { setUploadError('Enter a name, valid costs and a reservation deadline.'); return; }
    const saved = await mutate('/collection', { name, collectionPriceCents: Math.round(Number(price) * 100), sharedCostCents: Math.round(Number(cost) * 100), reservationExpiresAt: new Date(reservation).toISOString(), photos, revision: state.revision }, 'PATCH');
    if (!saved) return;
    if (!analyze || !state.aiConfigured) { navigate('/catalog'); return; }
    if (!photos.length) { setUploadError('Upload a bundle photo to analyze.'); return; }
    setAiBusy(true);
    try { const result = await request<{ source: 'nebius' | 'rehearsal'; proposal: CatalogProposal }>('/ai/catalog', 'POST', { imageDataUrl: await imageDataUrl(photos[photos.length - 1]) }); setProposal(result.proposal); setProposalSource(result.source); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Could not analyze the photo.'); }
    finally { setAiBusy(false); }
  };
  return <>
    <PageHeading title={locked ? 'Bundle details' : 'Add a bundle'} subtitle="Add the bundle details and photos." />
    <div className="setup-columns"><div className="form-fields"><label>Name<input value={name} onChange={event => setName(event.target.value)} disabled={locked} /></label><label>Bundle price<div className="input-unit"><input inputMode="decimal" type="number" min="0" value={price} onChange={event => setPrice(event.target.value)} disabled={locked} /><span>PLN</span></div></label><label>Handling and delivery<div className="input-unit"><input inputMode="decimal" type="number" min="0" value={cost} onChange={event => setCost(event.target.value)} disabled={locked} /><span>PLN</span></div></label><label>Reserved until<input type="datetime-local" value={reservation} onChange={event => setReservation(event.target.value)} disabled={locked} /></label></div><div className="collection-photo-field"><label>Bundle photos</label><p className="caption">Add clear photos of the items. You can upload one or more photos.</p><div className="collection-photo">{photos.length ? <img src={photos[photos.length - 1]} alt={`Bundle photo: ${collection.name}`} /> : <div className="upload-empty"><ImagePlus size={35} /><span>Add a bundle photo</span></div>}</div><input type="file" accept="image/png,image/jpeg,image/webp" multiple ref={fileInput} className="visually-hidden" onChange={async event => { for (const file of Array.from(event.target.files || [])) await readFile(file); }} /><Button variant="secondary" disabled={locked} onClick={() => fileInput.current?.click()}><ImagePlus size={19} />Add / change photos</Button>{photos.length > 1 ? <p className="caption">{photos.length} photos added.</p> : null}</div></div>
    {uploadError ? <Notice tone="error">{uploadError}</Notice> : null}
    <div className="setup-total"><div><strong>Total cost</strong><p className="caption">Bundle price + handling and delivery</p></div><strong>{money(Number.isFinite(total) ? total : 0)}</strong></div>
    {locked ? <><Notice>Price shares and costs are locked once participants start submitting preferences.</Notice><Button onClick={() => navigate('/catalog')}>View catalog</Button></> : <><Button busy={busy || aiBusy} onClick={() => save(true)}>{aiBusy ? 'Analyzing photo…' : state.aiConfigured ? 'Identify items in photos' : 'Review the item catalog'}</Button><p className="caption centered">Review the catalog before inviting participants. AI does not set prices.</p>{state.aiConfigured ? <LinkButton className="centered-link manual-catalog-link" disabled={busy || aiBusy} onClick={() => void save(false)}>Review the catalog manually</LinkButton> : <p className="caption centered">This demo includes a prepared catalog. Connect Nebius to analyze your own photos.</p>}</>}
    {proposal ? <AiCatalogProposal proposal={proposal} source={proposalSource} state={state} mutate={mutate} navigate={navigate} /> : null}
  </>;
}

function AiCatalogProposal({ proposal, source, state, mutate, navigate }: { proposal: CatalogProposal; source?: 'nebius' | 'rehearsal'; state: OrganizerView; mutate: Mutate; navigate: (route: string) => void }) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries(proposal.items.map(item => [item.id, state.collection.items.some(existing => existing.id === item.id) ? item.id : ''])));
  const [applying, setApplying] = useState(false);
  const selected = Object.values(mapping).filter(Boolean);
  const valid = selected.length > 0 && selected.length === new Set(selected).size;
  const apply = async () => {
    setApplying(true); let revision = state.revision;
    try {
      for (const item of proposal.items) {
        const target = mapping[item.id]; if (!target) continue;
        const result = await mutate(`/items/${target}`, { name: item.name, description: item.description, confirmed: false, revision }, 'PATCH');
        if (!result || !result.state.authenticated) return;
        revision = result.state.revision;
      }
      navigate('/catalog');
    } finally { setApplying(false); }
  };
  return <section className="catalog-proposal"><h2>Review the photo analysis</h2><Notice>{source === 'nebius' ? 'These descriptions were suggested by Nebius AI. Match them to the correct catalog items and review them manually.' : 'This is a prepared example. AI has not analyzed the photo.'}<p>You will confirm conditions, photos and price shares separately.</p></Notice>{proposal.warnings?.map(warning => <p className="caption" key={warning}>{warning}</p>)}<div className="proposal-list">{proposal.items.map((item, index) => <div key={item.id}><span>{index + 1}</span><div><strong>{item.name}</strong><p>{item.description}</p><p className="caption">{(item.observedCondition ? displayCondition(item.observedCondition) : null) || 'Condition needs review'}{item.uncertain ? ' · uncertain result' : ''}</p><label className="proposal-mapping">Match to an item<select value={mapping[item.id]} disabled={applying} onChange={event => setMapping(current => ({ ...current, [item.id]: event.target.value }))}><option value="">Skip this result</option>{state.collection.items.map(existing => <option key={existing.id} value={existing.id}>#{existing.id} · {existing.name}</option>)}</select></label></div></div>)}</div>{selected.length !== new Set(selected).size ? <Notice tone="warning">Match each result to a different item.</Notice> : null}<Button variant="secondary" disabled={!valid} busy={applying} onClick={apply}>Apply selected descriptions to the catalog</Button><p className="caption">Descriptions will remain unconfirmed until you review them. Price shares will stay the same.</p><LinkButton className="centered-link" onClick={() => navigate('/catalog')}>Continue to the catalog without these results</LinkButton></section>;
}

function Catalog({ state, navigate, mutate, busy }: OrganizerProps) {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string>();
  const locked = state.collection.preferencesOpened;
  const ordered = useMemo(() => [...state.collection.items].sort((a, b) => { const ai = itemOrder.indexOf(a.id); const bi = itemOrder.indexOf(b.id); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.id.localeCompare(b.id); }), [state.collection.items]);
  const pageItems = ordered.slice(page * 6, page * 6 + 6);
  const reviewCount = ordered.filter(item => !item.confirmed).length;
  const sum = ordered.reduce((value, item) => value + item.shareCents, 0);
  const confirmGate = reviewCount ? { allowed: false, reason: 'Confirm all items first.' } : sum !== state.collection.collectionPriceCents ? { allowed: false, reason: 'Price shares must add up to the bundle price.' } : state.gates.confirmCatalog;
  const editItem = ordered.find(item => item.id === editing);
  const columns = useMemo<ColDef<CollectionItem>[]>(() => [
    { headerName: 'Item', field: 'id', minWidth: 190, flex: 1.25, cellRenderer: ({ data }: ICellRendererParams<CollectionItem>) => data ? <div className="catalog-identity"><span>#{data.id}</span><ItemImage src={data.imageUrl} alt={data.name} /></div> : null },
    { headerName: 'Name', field: 'name', minWidth: 160, flex: 1.2 },
    { headerName: 'Condition', field: 'condition', minWidth: 120, cellRenderer: ({ value }: ICellRendererParams) => <span className="condition-badge"><span />{displayCondition(value)}</span> },
    { headerName: 'Price share', field: 'shareCents', minWidth: 140, valueFormatter: params => money(params.value || 0) },
    { headerName: 'Review', field: 'confirmed', minWidth: 210, flex: 1.4, cellRenderer: ({ data }: ICellRendererParams<CollectionItem>) => data ? data.confirmed ? <button className="catalog-confirmed" disabled={locked} onClick={() => setEditing(data.id)}>Confirmed {!locked ? <ChevronRight size={15} /> : null}</button> : <button className="review-action" onClick={() => setEditing(data.id)}>Review result <ChevronRight size={16} /></button> : null },
  ], [locked]);
  return <>
    <PageHeading title={locked ? 'Item catalog' : 'Review identified items'} subtitle={`${ordered.length} items · ${reviewCount ? `${reviewCount} need review` : 'all confirmed'}`} />
    <div className="desktop-grid"><FlatGrid rowData={pageItems} columnDefs={columns} rowHeight={85} getRowId={({ data }) => data.id} /></div>
    <div className="mobile-catalog">{pageItems.map(item => <button className="mobile-catalog-row" key={item.id} onClick={() => setEditing(item.id)}><ItemImage src={item.imageUrl} alt={item.name} /><div><strong>#{item.id} · {item.name}</strong><p>{displayCondition(item.condition)} · {money(item.shareCents)}</p><span className={item.confirmed ? 'green' : 'amber'}>{item.confirmed ? 'Confirmed' : 'Review result'}</span></div><ChevronRight size={19} /></button>)}</div>
    {editItem ? <CatalogEdit key={`${editItem.id}-${editItem.confirmed}`} item={editItem} locked={locked} busy={busy} onClose={() => setEditing(undefined)} onSave={async value => { const result = await mutate(`/items/${editItem.id}`, { ...value, revision: state.revision }, 'PATCH'); if (result) setEditing(undefined); }} /> : null}
    <div className="catalog-footer"><div className="pagination"><span className="caption">Showing {Math.min((page + 1) * 6, ordered.length)} of {ordered.length}</span>{page > 0 ? <Button variant="secondary" onClick={() => setPage(current => current - 1)} aria-label="Previous page"><ChevronLeft size={17} /></Button> : null}<Button variant="secondary" disabled={(page + 1) * 6 >= ordered.length} onClick={() => setPage(current => current + 1)}>Next <ArrowRight size={17} /></Button></div><div className="catalog-share-total"><strong>Total price shares: <span className={sum === state.collection.collectionPriceCents ? 'green' : 'amber'}>{money(sum)}</span></strong><p className="caption">Set price shares before collecting budgets.</p></div><div className="catalog-confirm-action"><Button busy={busy} disabled={!confirmGate.allowed && !locked} onClick={async () => { if (locked) { navigate('/participants'); return; } const result = await mutate('/catalog/confirm', { revision: state.revision }); if (result) navigate('/participants'); }}>{locked ? 'View preferences' : 'Confirm catalog'}</Button><GateNote gate={locked ? undefined : confirmGate} /></div></div>
  </>;
}

function CatalogEdit({ item, locked, onClose, onSave, busy }: { item: CollectionItem; locked: boolean; onClose: () => void; onSave: (value: Partial<CollectionItem>) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState(item.name); const [description, setDescription] = useState(item.description); const [condition, setCondition] = useState(item.condition); const [share, setShare] = useState(String(item.shareCents / 100));
  return <section className="catalog-edit" aria-label={`Review item #${item.id}`}><div className="catalog-edit-heading"><h2>Item #{item.id}</h2><button className="icon-button" onClick={onClose} aria-label="Close editor"><X size={21} /></button></div><div className="catalog-edit-body"><ItemImage src={item.imageUrl} alt={item.name} /><div className="form-fields"><div className="form-two-col"><label>Name<input value={name} onChange={event => setName(event.target.value)} disabled={locked} /></label><label>Condition<select value={condition} onChange={event => setCondition(event.target.value)} disabled={locked}><option value="Dobry">Good</option><option value="Bardzo dobry">Very good</option><option value="Ślady użycia">Signs of wear</option><option value="Uszkodzony">Damaged</option></select></label></div><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={2} disabled={locked} /></label><div className="catalog-edit-bottom"><label>Price share<div className="input-unit"><input type="number" inputMode="decimal" value={share} onChange={event => setShare(event.target.value)} min="0" disabled={locked} /><span>PLN</span></div></label><Button busy={busy} variant="secondary" disabled={locked || !name.trim() || !Number.isFinite(Number(share)) || Number(share) < 0} onClick={() => onSave({ name, description, condition, shareCents: Math.round(Number(share) * 100), confirmed: true })}>Confirm item</Button></div></div></div></section>;
}

function Participants({ state, navigate, mutate, busy }: OrganizerProps) {
  const [copied, setCopied] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const active = state.participants.filter(person => person.active);
  const solveGate = state.progress.preferences < state.progress.requiredBuyers ? { allowed: false, reason: `Waiting for ${state.progress.requiredBuyers - state.progress.preferences} participants to submit preferences.` } : state.gates.solve;
  const invitation = state.invitations.find(value => value.active);
  const copy = async (url: string, id: string) => {
    let target = url;
    if (url.endsWith('/invite/')) {
      const buyerId = id === 'group' ? invitation?.buyerId : id;
      if (!buyerId) return;
      const result = await mutate('/invitations', { buyerId, revision: state.revision });
      if (!result?.link) return;
      target = result.link;
    }
    await navigator.clipboard.writeText(new URL(target, window.location.origin).href); setCopied(id);
  };
  const columns = useMemo<ColDef<Participant>[]>(() => [
    { headerName: 'Participant', field: 'name', minWidth: 150, flex: 1.3, cellRenderer: ({ data }: ICellRendererParams<Participant>) => <strong>{data?.name}</strong> },
    { headerName: 'Selected items', minWidth: 200, flex: 2, cellRenderer: ({ data }: ICellRendererParams<Participant>) => data?.preferences ? <button className="table-text-button" onClick={() => setExpanded(current => current === data.id ? undefined : data.id)}>{data.preferences.preferredItemIds.length} items <ChevronDown size={15} /></button> : '—' },
    { headerName: 'Budget', minWidth: 120, valueGetter: params => params.data?.preferences?.budgetCents, valueFormatter: params => params.value ? money(params.value) : '—' },
    { headerName: 'Status', minWidth: 190, cellRenderer: ({ data }: ICellRendererParams<Participant>) => <span className={data?.preferences?.submittedAt ? 'green' : 'muted'}>{data?.preferences?.submittedAt ? 'Submitted' : data?.preferences ? 'Alternatives needed' : 'Waiting for preferences'}</span> },
    { headerName: '', maxWidth: 80, cellRenderer: ({ data }: ICellRendererParams<Participant>) => { const invite = state.invitations.find(value => value.buyerId === data?.id); return invite ? <button className="icon-button" title={`Copy invitation: ${data?.name}`} onClick={() => void copy(invite.url, invite.buyerId)}>{copied === invite.buyerId ? <Check size={18} /> : <Copy size={17} />}</button> : null; } },
  ], [state.invitations, copied]);
  const expandedPerson = state.participants.find(person => person.id === expanded);
  return <>
    <PageHeading title="Collecting preferences" subtitle={`${state.collection.name} · ${state.collection.items.length} items · total ${money(state.collection.totalCents)}`} />
    <div className="invite-block"><label>Invitation link<input value={invitation ? new URL(invitation.url, window.location.origin).href : ''} readOnly /></label><Button onClick={() => invitation && void copy(invitation.url, 'group')}>{copied === 'group' ? <><Check size={18} />Invitation copied</> : 'Copy invitation'}</Button></div>
    <div className="desktop-grid"><FlatGrid rowData={active} columnDefs={columns} rowHeight={94} getRowId={({ data }) => data.id} /></div>
    <div className="mobile-table-list">{active.map(person => <div key={person.id}><strong>{person.name}</strong><div><span>{person.preferences ? `${person.preferences.preferredItemIds.length} items · ${money(person.preferences.budgetCents)}` : 'Waiting for preferences'}</span><span className="green">{person.preferences?.submittedAt ? 'Submitted' : ''}</span></div></div>)}</div>
    {expandedPerson?.preferences ? <div className="expanded-preferences"><h3>Preferences: {expandedPerson.name}</h3><ItemGrid items={byIds(state.collection.items, expandedPerson.preferences.preferredItemIds)} compact /><p className="caption">Alternatives: {expandedPerson.preferences.alternativeItemIds.map(id => `#${id}`).join(', ') || 'none'}. Participants may select the same items.</p></div> : null}
    <div className="table-action-footer"><p className="muted">{state.progress.preferences} of {state.progress.requiredBuyers} participants have submitted preferences</p><div><Button busy={busy} disabled={!solveGate.allowed} onClick={async () => { const result = await mutate('/plan/solve', { revision: state.revision }); if (result) navigate('/allocation'); }}>Calculate allocation</Button><GateNote gate={solveGate} /></div></div>
    {!state.collection.preferencesOpened ? <Notice tone="warning">Confirm the item catalog first.</Notice> : null}
    <LinkButton onClick={() => navigate('/catalog')}>View confirmed catalog</LinkButton>
  </>;
}

type AllocationRow = { id: string; assignment: PlanAssignmentView; detail?: boolean };
function Allocation({ state, navigate, mutate, busy }: OrganizerProps) {
  const [expanded, setExpanded] = useState<string>(state.plan?.assignments[0]?.buyerId || '');
  const [copied, setCopied] = useState(false);
  const plan = state.plan;
  const rows = useMemo<AllocationRow[]>(() => plan?.assignments.flatMap(assignment => [{ id: assignment.buyerId, assignment }, ...(assignment.buyerId === expanded ? [{ id: `${assignment.buyerId}-detail`, assignment, detail: true }] : [])]) || [], [plan?.assignments, expanded]);
  const sent = plan?.status !== 'draft';
  const columns = useMemo<ColDef<AllocationRow>[]>(() => [
    { headerName: 'Participant', minWidth: 200, flex: 2.4, cellRenderer: ({ data }: ICellRendererParams<AllocationRow>) => data ? <strong>{data.assignment.buyerName}</strong> : null },
    { headerName: 'Allocation', minWidth: 140, flex: 1.6, valueGetter: params => `${params.data?.assignment.itemIds.length || 0} items` },
    { headerName: sent ? 'Plan total' : 'Amount', minWidth: 150, flex: 1, valueGetter: params => params.data?.assignment.totalCents, valueFormatter: params => money(params.value || 0) },
    sent ? { headerName: 'Agreement', minWidth: 260, flex: 1.5, cellRenderer: ({ data }: ICellRendererParams<AllocationRow>) => data ? data.assignment.consent ? <Status status="accepted" preserved={!!data.assignment.consent.preservedFromPlanId} /> : <span className={plan && plan.version > 1 ? 'amber' : 'muted'}>{plan && plan.version > 1 && data.assignment.previous ? 'New agreement needed' : 'Waiting for agreement'}</span> : null } : { headerName: 'Budget', minWidth: 110, flex: 0.6, valueGetter: params => params.data?.assignment.budgetCents, valueFormatter: params => money(params.value || 0) },
    { headerName: '', width: 55, maxWidth: 55, cellRenderer: ({ data }: ICellRendererParams<AllocationRow>) => data ? <button className="icon-button" aria-label={`Expand allocation: ${data.assignment.buyerName}`} onClick={() => setExpanded(current => current === data.assignment.buyerId ? '' : data.assignment.buyerId)}>{data.assignment.buyerId === expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}</button> : null },
  ], [sent, expanded, plan?.version]);
  if (state.noSolution) return <NoSolution {...{ state, navigate, mutate, busy, refresh: async () => {}, route: '/allocation' }} />;
  if (plan?.status === 'invalidated') return <><PageHeading title="Recalculate the plan" subtitle={`Plan ${plan.version} · ${state.collection.name}`} /><Notice tone="warning">{plan.invalidationReason || 'The terms or participant preferences have changed. The previous plan can no longer proceed.'}</Notice><p className="section-description">Review the current preferences and calculate a new version. Agreements are kept only when the terms are exactly the same.</p><Button onClick={() => navigate('/participants')}>View participant preferences</Button></>;
  if (!plan) return <><PageHeading title="Item allocation" subtitle="Collect preferences from all four participants." /><Button onClick={() => navigate('/participants')}>View preferences</Button></>;
  const complete = state.progress.agreements === state.progress.requiredBuyers;
  const changed = plan.version > 1;
  return <>
    <PageHeading title={!sent ? changed ? 'New allocation after a withdrawal' : 'Review allocation' : complete ? 'Everyone has accepted the plan' : 'Waiting for agreement'} subtitle={!sent ? changed ? `Plan ${plan.version} · Jan withdrew, Ewa joined` : `${state.collection.items.length} items · ${state.progress.requiredBuyers} participants` : `Plan ${plan.version} · ${state.progress.agreements} of ${state.progress.requiredBuyers} participants accepted`}>
      {!sent && !changed ? <div className="heading-total"><span>Plan total</span><strong>{money(state.collection.totalCents)}</strong></div> : null}
    </PageHeading>
    {!sent ? <div className="plan-context"><p>Bundle {money(state.collection.collectionPriceCents)} + handling and delivery {money(state.collection.sharedCostCents)}</p><p className="caption">Plan {plan.version} · not sent</p></div> : null}
    <div className="desktop-grid"><FlatGrid<AllocationRow> rowData={rows} columnDefs={columns} getRowId={({ data }) => data.id} isFullWidthRow={({ rowNode }) => !!rowNode.data?.detail} getRowHeight={({ data }) => data?.detail ? 235 : 60} fullWidthCellRenderer={({ data }: { data: AllocationRow }) => <div className="allocation-detail"><ItemGrid items={byIds(state.collection.items, data.assignment.itemIds)} compact highlightIds={data.assignment.previous ? data.assignment.itemIds.filter(id => !data.assignment.previous?.itemIds.includes(id)) : undefined} /></div>} /></div>
    <div className="mobile-allocation-list">{plan.assignments.map(assignment => <section key={assignment.buyerId}><button onClick={() => setExpanded(current => current === assignment.buyerId ? '' : assignment.buyerId)}><strong>{assignment.buyerName}</strong><span>{assignment.itemIds.length} items · {money(assignment.totalCents)}</span><ChevronDown size={18} /></button>{sent ? <Status status={assignment.consent ? 'accepted' : 'waiting'} preserved={!!assignment.consent?.preservedFromPlanId} /> : <p className="caption">Budget {money(assignment.budgetCents)}</p>}{expanded === assignment.buyerId ? <ItemGrid items={byIds(state.collection.items, assignment.itemIds)} compact /> : null}</section>)}</div>
    <div className="allocation-total"><strong>Total</strong><strong>{state.collection.items.length} items</strong><strong>{money(state.collection.totalCents)}</strong><span>—</span></div>
    {changed ? <div className="plan-change-summary">{plan.assignments.filter(assignment => assignment.previous && (assignment.previous.totalCents !== assignment.totalCents || assignment.previous.itemIds.join() !== assignment.itemIds.join())).map(assignment => <p key={assignment.buyerId}><strong>{assignment.buyerName}:</strong> {assignment.previous?.itemIds.filter(id => !assignment.itemIds.includes(id)).map(id => `#${id}`).join(', ')} <ArrowRight size={15} /> {assignment.itemIds.filter(id => !assignment.previous?.itemIds.includes(id)).map(id => `#${id}`).join(', ')}, {money(assignment.previous!.totalCents)} <ArrowRight size={15} /> {money(assignment.totalCents)}.</p>)}<p className="muted">Agreements are kept only when the terms are exactly the same.</p></div> : null}
    <div className="table-action-footer"><p className="caption">{sent ? 'PayPal authorizations start once everyone agrees.' : 'Payment starts once everyone accepts the plan.'}</p><div>{!sent ? <Button busy={busy} disabled={!state.gates.sendPlan.allowed} onClick={() => mutate('/plan/send', { planId: plan.id, revision: state.revision })}>{changed ? 'Send changes for approval' : 'Send plan for approval'}</Button> : complete ? <Button onClick={() => navigate('/payments')}>View payments</Button> : <Button onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/#/plan`); setCopied(true); }}>{copied ? 'Link copied' : 'Copy plan link'}</Button>}<GateNote gate={!sent ? state.gates.sendPlan : undefined} /></div></div>
  </>;
}

function NoSolution({ state, navigate, mutate, busy }: OrganizerProps) {
  const noSolution = state.noSolution;
  const [inviting, setInviting] = useState(false);
  const active = state.participants.filter(person => person.active);
  const leaving = state.participants.find(person => !person.active && person.withdrawnAt);
  const replacement = state.participants.find(person => !person.active && !person.withdrawnAt) || state.participants.find(person => !person.active && person.id !== leaving?.id);
  const invitationName = replacement?.name || '';
  const missingPerson = active.length < state.progress.requiredBuyers;
  const sumLimits = noSolution?.limitsTotalCents || active.reduce((sum, person) => sum + (person.preferences?.budgetCents || 0), 0);
  const columns: ColDef<Participant>[] = [
    { headerName: 'Participant', field: 'name', flex: 1.5, cellRenderer: ({ value }: ICellRendererParams) => <strong>{value}</strong> },
    { headerName: 'Item count', valueGetter: params => `${params.data?.preferences?.preferredItemIds.length || 0} items`, flex: 1.5 },
    { headerName: 'Budget', valueGetter: params => params.data?.preferences?.budgetCents || 0, valueFormatter: params => money(params.value) },
  ];
  return <>
    <div className="no-solution-heading"><PageHeading title="The purchase cannot proceed" subtitle={`${active.length} participants remain.`} /><div className="gap-costs"><CostRows rows={[{ label: 'Bundle with handling and delivery', cents: state.collection.totalCents }, { label: 'Total active budgets', cents: sumLimits }]} total={{ label: 'Minimum shortfall', cents: noSolution?.shortfallCents ?? Math.max(0, state.collection.totalCents - sumLimits) }} /></div></div>
    <p className="section-description">{noSolution?.unassignedItemIds.length || 6} items remain unassigned. No money has been captured.</p>
    <Notice tone="warning">{noSolution?.message || state.plan?.invalidationReason || 'The previous plan is no longer valid. Invite a participant and calculate a new allocation.'}</Notice>
    <div className="desktop-grid no-solution-grid"><FlatGrid rowData={active} columnDefs={columns} rowHeight={72} /></div>
    <div className="mobile-table-list">{active.map(person => <div key={person.id}><strong>{person.name}</strong><span>{money(person.preferences?.budgetCents || 0)}</span></div>)}</div>
    {noSolution?.unassignedItemIds.length ? <details className="unassigned-items"><summary>Show unassigned items</summary><ItemGrid items={byIds(state.collection.items, noSolution.unassignedItemIds)} compact /></details> : null}
    {!missingPerson ? <Button onClick={() => navigate('/participants')}>Review participant preferences</Button> : !inviting ? <Button onClick={() => setInviting(true)}>Invite a participant</Button> : <div className="replacement-form"><h2>{replacement ? `Invite ${invitationName} to fill the open place` : 'Invite a participant to fill the open place'}</h2><p className="muted">The new participant will submit preferences and a budget. The new plan requires agreement to its exact terms.</p>{replacement && leaving ? <Button busy={busy} onClick={async () => { const result = await mutate('/participants/replace', { leavingBuyerId: leaving.id, replacementBuyerId: replacement.id, revision: state.revision }); if (result) navigate('/participants'); }}>Add {invitationName} to the group</Button> : <Button onClick={() => navigate('/participants')}>View invitations</Button>}</div>}
  </>;
}

function Payments({ state, navigate, mutate, busy }: OrganizerProps) {
  const plan = state.plan;
  const [operationsOpen, setOperationsOpen] = useState(false);
  const failed = plan?.status === 'failed';
  const uncertain = plan?.status === 'reconciling' || plan?.status === 'capturing';
  const paid = plan?.status === 'paid';
  const capturedTotal = plan?.assignments.reduce((sum, assignment) => sum + (assignment.payment.capture?.status === 'COMPLETED' ? assignment.totalCents : 0), 0) || 0;
  const refundTotal = plan?.assignments.reduce((sum, assignment) => sum + (assignment.payment.refund && assignment.payment.refund.status !== 'COMPLETED' ? assignment.payment.refund.amountCents : 0), 0) || 0;
  const voidTotal = plan?.assignments.reduce((sum, assignment) => sum + (assignment.payment.void && assignment.payment.void.status !== 'VOIDED' ? assignment.payment.void.amountCents : 0), 0) || 0;
  const columns = useMemo<ColDef<PlanAssignmentView>[]>(() => [
    { headerName: 'Participant', field: 'buyerName', minWidth: 160, flex: 1.25, cellRenderer: ({ value }: ICellRendererParams) => <strong>{value}</strong> },
    { headerName: 'Amount', field: 'totalCents', minWidth: 115, flex: 0.8, valueFormatter: params => money(params.value || 0) },
    ...(!failed && !uncertain && !paid ? [{ headerName: 'Agreement', minWidth: 180, flex: 1.1, cellRenderer: ({ data }: ICellRendererParams<PlanAssignmentView>) => <Status status={data?.consent ? 'accepted' : 'waiting'} /> } satisfies ColDef<PlanAssignmentView>, { headerName: 'Authorization', minWidth: 190, flex: 1.2, cellRenderer: ({ data }: ICellRendererParams<PlanAssignmentView>) => <Status status={data?.payment.authorization?.status} kind="authorization" /> } satisfies ColDef<PlanAssignmentView>] : []),
    { headerName: uncertain ? 'Result' : 'Capture', minWidth: 210, flex: 1.3, cellRenderer: ({ data }: ICellRendererParams<PlanAssignmentView>) => <Status status={data?.payment.capture?.status} kind="capture" /> },
    ...(failed ? [{ headerName: 'Settlement', minWidth: 250, flex: 1.6, cellRenderer: ({ data }: ICellRendererParams<PlanAssignmentView>) => <Status status={data?.payment.refund?.status || data?.payment.void?.status} kind={data?.payment.refund ? 'refund' : 'void'} /> } satisfies ColDef<PlanAssignmentView>] : []),
  ], [failed, uncertain, paid]);
  if (!plan) return <><PageHeading title="Payments" subtitle="Prepare and send a plan first." /><Button onClick={() => navigate('/allocation')}>View allocation</Button></>;
  const title = failed ? 'Purchase on hold' : uncertain ? 'Confirming payments' : paid ? 'All payments completed' : state.gates.capture.allowed ? 'Ready to capture payments' : 'Waiting for authorizations';
  return <>
    <PageHeading title={title} subtitle={failed ? 'One payment failed. Do not start packing.' : uncertain ? 'Do not retry the capture. We are checking the result with PayPal.' : `Agreements ${state.progress.agreements}/${state.progress.requiredBuyers} · Authorizations ${state.progress.authorizations}/${state.progress.requiredBuyers} · Captured ${money(capturedTotal)}`} />
    <div className="desktop-grid"><FlatGrid rowData={plan.assignments} columnDefs={columns} rowHeight={100} getRowId={({ data }) => data.buyerId} /></div>
    <div className="mobile-settlement-list">{plan.assignments.map(assignment => <div key={assignment.buyerId}><div><strong>{assignment.buyerName}</strong><span>{money(assignment.totalCents)}</span></div><Status status={failed || uncertain || paid ? assignment.payment.capture?.status : assignment.payment.authorization?.status} kind={failed || uncertain || paid ? 'capture' : 'authorization'} />{failed ? <Status status={assignment.payment.refund?.status || assignment.payment.void?.status} kind={assignment.payment.refund ? 'refund' : 'void'} /> : null}</div>)}</div>
    <div className="payment-totals">{failed ? <strong>{money(refundTotal)} to refund · {money(voidTotal)} in holds to release</strong> : uncertain ? <><strong>Confirmed captures</strong><p>{money(capturedTotal)} of {money(state.collection.totalCents)}</p></> : <><strong>Total</strong><strong>{money(state.collection.totalCents)}</strong></>}</div>
    {state.reservationExpired ? <Notice tone="warning">The reservation has expired. New captures are blocked. Pending refunds and hold releases will continue to be processed.</Notice> : null}
    {failed ? <><Button busy={busy} onClick={() => mutate('/payments/reconcile', {})}>Check settlement</Button><p className="caption centered">Refunds and hold releases have separate confirmations.</p></> : uncertain ? <div className="uncertain-actions"><Notice tone="warning"><strong>Packing is blocked until payment status is confirmed.</strong><p>Packing can start once all payments are confirmed.</p></Notice><Button busy={busy} onClick={() => mutate('/payments/reconcile', {})}>Check status</Button></div> : paid ? <Button onClick={() => navigate('/packing')}>View packing list</Button> : <><Button busy={busy} disabled={!state.gates.capture.allowed} onClick={() => mutate('/payments/capture', { planId: plan.id, revision: state.revision })}>Capture payments — {money(state.collection.totalCents)}</Button><GateNote gate={state.gates.capture} fallback="Each payment is captured separately." /></>}
    <div className="operations-disclosure"><LinkButton onClick={() => setOperationsOpen(value => !value)}>{operationsOpen ? 'Hide transaction details' : 'Transaction details'}</LinkButton>{operationsOpen ? <div className="operation-list">{plan.assignments.flatMap(assignment => Object.values(assignment.payment).map(operation => <div key={operation.id}><div><strong>{assignment.buyerName} · {operation.kind}</strong><Status status={operation.status} kind={operation.kind === 'refund' ? 'refund' : operation.kind === 'void' ? 'void' : 'operation'} /></div><p>Transaction ID: <code>{operation.id}</code></p><p>PayPal: <code>{operation.providerId || 'awaiting ID'}</code></p><p>Idempotency key: <code>{operation.idempotencyKey}</code></p>{operation.status === 'FAILED' && ['refund', 'void'].includes(operation.kind) ? <Button variant="secondary" busy={busy} onClick={() => mutate('/payments/retry-compensation', { operationId: operation.id })}>Retry {operation.kind === 'refund' ? 'refund' : 'hold release'} after a confirmed failure</Button> : null}</div>))}</div> : null}</div>
  </>;
}

function Packing({ state, navigate, mutate, busy }: OrganizerProps) {
  const [expanded, setExpanded] = useState<string>(state.packing[0]?.buyerId || '');
  if (!state.gates.packing.allowed) return <><PageHeading title="Packing is blocked" /><Notice tone="warning">{state.gates.packing.reason || 'The packing list will be available after all four captures are confirmed.'}</Notice><Button onClick={() => navigate('/payments')}>View payments</Button></>;
  const rows = state.packing.flatMap(pack => [{ id: pack.buyerId, pack }, ...(expanded === pack.buyerId ? [{ id: `${pack.buyerId}-detail`, pack, detail: true }] : [])]);
  type PackRow = typeof rows[number];
  const columns: ColDef<PackRow>[] = [
    { headerName: 'Participant', minWidth: 170, flex: 1.5, cellRenderer: ({ data }: ICellRendererParams<PackRow>) => <strong>{data?.pack.buyerName}</strong> },
    { headerName: 'Items', minWidth: 120, flex: 0.9, valueGetter: params => `${params.data?.pack.itemIds.length} items` },
    { headerName: 'Shipping address', minWidth: 300, flex: 2, cellRenderer: ({ data }: ICellRendererParams<PackRow>) => data ? <div className="packing-address-cell"><span>{data.pack.address.recipient}</span><span>{data.pack.address.street} · {data.pack.address.postalCode} {data.pack.address.city}</span></div> : null },
    { headerName: 'Packed', minWidth: 165, flex: 1.2, cellRenderer: ({ data }: ICellRendererParams<PackRow>) => data ? <label className="check-label"><input type="checkbox" checked={!!data.pack.packedAt} disabled={busy || data.pack.checkedItemIds.length !== data.pack.itemIds.length || !!data.pack.shippedAt} onChange={event => void mutate(`/packing/${data.pack.buyerId}`, { packed: event.target.checked, revision: state.revision }, 'PUT')} />Packed</label> : null },
    { headerName: '', width: 50, maxWidth: 50, cellRenderer: ({ data }: ICellRendererParams<PackRow>) => data ? <button className="icon-button" onClick={() => setExpanded(current => current === data.pack.buyerId ? '' : data.pack.buyerId)} aria-label={`Packing list: ${data.pack.buyerName}`}>{expanded === data.pack.buyerId ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</button> : null },
  ];
  const detail = (pack: PackingPackage) => <div className="packing-detail"><div className="packing-items">{byIds(state.collection.items, pack.itemIds).map(item => <label key={item.id} className="packing-item"><ItemImage src={item.imageUrl} alt={item.name} /><span><input type="checkbox" checked={pack.checkedItemIds.includes(item.id)} disabled={busy || !!pack.packedAt} onChange={event => void mutate(`/packing/${pack.buyerId}`, { checkedItemIds: event.target.checked ? [...pack.checkedItemIds, item.id] : pack.checkedItemIds.filter(id => id !== item.id), revision: state.revision }, 'PUT')} />#{item.id}</span></label>)}</div><div className="packing-detail-footer"><p className="caption">{pack.checkedItemIds.length} of {pack.itemIds.length} items checked · captured {money(pack.totalCents)}</p>{pack.shippedAt ? <span className="green">Marked as shipped {dateTime(pack.shippedAt)}</span> : pack.packedAt ? <Button variant="secondary" busy={busy} onClick={() => mutate(`/packing/${pack.buyerId}`, { shipped: true, revision: state.revision }, 'PUT')}>Mark as shipped</Button> : <p className="caption">Check off each item after placing it in the package.</p>}</div></div>;
  return <>
    <PageHeading title="Ready to pack" subtitle={`${state.progress.captures} payments completed · captured ${money(state.collection.totalCents)}`} />
    <p className="muted packing-context">{state.collection.items.length} items · {state.progress.requiredBuyers} participants</p>
    <div className="desktop-grid"><FlatGrid<PackRow> rowData={rows} columnDefs={columns} getRowId={({ data }) => data.id} isFullWidthRow={({ rowNode }) => !!rowNode.data?.detail} getRowHeight={({ data }) => data?.detail ? 275 : 80} fullWidthCellRenderer={({ data }: { data: PackRow }) => detail(data.pack)} /></div>
    <div className="mobile-packing-list">{state.packing.map(pack => <section key={pack.buyerId}><h2>{pack.buyerName}</h2><p>{pack.address.recipient}<br />{pack.address.street}<br />{pack.address.postalCode} {pack.address.city}</p>{detail(pack)}<Button variant="secondary" busy={busy} disabled={pack.checkedItemIds.length !== pack.itemIds.length || !!pack.packedAt} onClick={() => mutate(`/packing/${pack.buyerId}`, { packed: true, revision: state.revision }, 'PUT')}>{pack.packedAt ? 'Packed' : 'Mark as packed'}</Button></section>)}</div>
    <div className="table-action-footer"><p className="caption">Mark packages as packed or shipped once each step is complete.</p><Button variant="secondary" onClick={() => window.print()}><Printer size={18} />Print packing lists</Button></div>
  </>;
}
