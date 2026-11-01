import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, FlaskConical, Loader2, LogOut, Mail, X } from 'lucide-react';
import type { AppView, AnonymousView, DemoAccess, RehearsalScenario } from '../shared/types';
import { DEFAULT_DEMO_COLLECTION_ID, DEMO_COLLECTIONS } from '../shared/demo-collections';
import type { DemoCollectionId } from '../shared/demo-collections';
import { useApplication, useRoute } from './api';
import type { Mutate } from './api';
import { Button, Notice } from './components';
import BuyerFlow from './BuyerFlow';
import AppV2 from './v2/AppV2';

const OrganizerFlow = lazy(() => import('./organizer/OrganizerFlow'));
const roles: DemoAccess[] = [
  { name: 'Kasia', role: 'organizer', inviteToken: 'demo-kasia' },
  { name: 'Maja', role: 'buyer', inviteToken: 'demo-maja' },
  { name: 'Ola', role: 'buyer', inviteToken: 'demo-ola' },
  { name: 'Bartek', role: 'buyer', inviteToken: 'demo-bartek' },
  { name: 'Jan', role: 'buyer', inviteToken: 'demo-jan' },
  { name: 'Ewa', role: 'buyer', inviteToken: 'demo-ewa' },
];
const organizerPages = [
  { route: '/setup', label: 'Bundle details' }, { route: '/catalog', label: 'Item catalog' },
  { route: '/participants', label: 'Participant choices' }, { route: '/allocation', label: 'Allocation plan' },
  { route: '/payments', label: 'Payments and settlement' }, { route: '/packing', label: 'Packing list' },
];

export default function App() {
  const app = useApplication();
  const { state, loading, busy, error, notice, mutate, refresh } = app;
  const { route, navigate } = useRoute();
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(false);
  const paymentReturnHandled = useRef(false);
  useEffect(() => { setMenu(false); }, [route]);
  useEffect(() => {
    if (window.location.pathname.startsWith('/payment/approve')) navigate('/payment-approval');
    const isReturn = window.location.pathname === '/payment/return';
    const isCancel = window.location.pathname === '/payment/cancel';
    if ((!isReturn && !isCancel) || paymentReturnHandled.current) return;
    paymentReturnHandled.current = true;
    const operationId = new URLSearchParams(window.location.search).get('operationId');
    if (!operationId) { app.setError('Authorization ID is missing. Check your current payment status.'); navigate('/payment'); return; }
    void mutate(isCancel ? '/payments/cancel' : '/payments/approve', { operationId }).finally(() => {
      window.history.replaceState(null, '', '/#/payment');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  }, []);
  const loginDemo = async (access: DemoAccess, collectionId?: DemoCollectionId) => {
    const result = await mutate('/auth/demo', { inviteToken: access.inviteToken, collectionId });
    if (result) { navigate('/'); setDemo(false); setMenu(false); }
  };
  if ((loading || busy) && !state) return <div className="application-loading"><span className="brand">LOTSPLIT</span><Loader2 size={26} className="spin" /><p>{busy ? 'Checking authorization status…' : 'Opening your bundle…'}</p></div>;
  if (!state) return <div className="application-loading"><span className="brand">LOTSPLIT</span><Notice tone="error">{error || 'Unable to connect to the app.'}</Notice><Button onClick={() => void refresh()}>Try again</Button></div>;
  if(state.conceptVersion===2) return <AppV2 app={app} routing={{route,navigate}}/>;
  const isBuyer = state.authenticated && state.role === 'buyer';
  return <div className={`application ${isBuyer || !state.authenticated ? 'buyer-application' : 'organizer-application'} ${!state.authenticated && state.mode === 'rehearsal' ? 'entry-application' : ''}`}>
    <div className={`mode-bar ${state.mode === 'rehearsal' ? 'mode-rehearsal' : 'mode-sandbox'}`}><span><FlaskConical size={13} />{state.mode === 'rehearsal' ? 'Demo mode · simulated payments' : 'PayPal sandbox — test payments'}</span>{state.mode === 'rehearsal' ? <button onClick={() => setDemo(true)}>Try the demo</button> : null}</div>
    <header className="app-header"><div className="header-inner">
      {isBuyer && route !== '/' && route !== '/collection' ? <button className="header-back icon-button" aria-label="Back" onClick={() => navigate(route.startsWith('/item/') ? `/${route.split('from=')[1] || 'collection'}` : '/collection')}><ArrowLeft size={24} strokeWidth={1.6} /></button> : null}
      <button className="brand" onClick={() => navigate('/')} aria-label="LOTSPLIT — home">LOTSPLIT</button>
      {state.authenticated ? <div className="account-menu"><button className="account-button" onClick={() => setMenu(value => !value)} aria-expanded={menu}>{state.me.name}<ChevronDown size={17} /></button>{menu ? <><button className="menu-scrim" aria-label="Close menu" onClick={() => setMenu(false)} /><nav className="account-dropdown" aria-label="App navigation">{state.role === 'organizer' ? organizerPages.map(page => <button key={page.route} onClick={() => navigate(page.route)}>{page.label}</button>) : <><button onClick={() => navigate('/collection')}>Bundle</button><button onClick={() => navigate('/selection')}>My selection and budget</button>{state.plan && state.plan.status !== 'draft' ? <button onClick={() => navigate('/plan')}>My plan</button> : null}{state.plan?.consent ? <button onClick={() => navigate('/payment')}>My payment</button> : null}</>}{state.mode === 'rehearsal' ? <button onClick={() => { setMenu(false); setDemo(true); }}><FlaskConical size={15} />Try the demo</button> : null}<button className="logout-button" onClick={async () => { const result = await mutate('/auth/logout', {}); if (result) { navigate('/'); setMenu(false); } }}><LogOut size={15} />Sign out</button></nav></> : null}</div> : null}
    </div></header>
    {error ? <div className="global-message"><Notice tone="error"><div className="dismissable-message"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => app.setError(undefined)}><X size={17} /></button></div></Notice></div> : null}
    {notice ? <div className="global-message"><Notice tone="success"><div className="dismissable-message"><span>{notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => app.setNotice(undefined)}><X size={17} /></button></div></Notice></div> : null}
    {!state.authenticated ? <Entry state={state} busy={busy} mutate={mutate} onDemo={loginDemo} /> : state.role === 'buyer' ? <BuyerFlow key={`${state.mode}:${state.collection.id}:${state.me.id}:${state.mode === 'rehearsal' ? state.collection.reservationExpiresAt : ''}`} state={state} route={route} navigate={navigate} mutate={mutate} busy={busy} refresh={refresh} /> : <Suspense fallback={<div className="application-loading"><Loader2 size={24} className="spin" /></div>}><OrganizerFlow state={state} route={route} navigate={navigate} mutate={mutate} busy={busy} refresh={refresh} /></Suspense>}
    {demo && state.mode === 'rehearsal' ? <DemoDrawer state={state} busy={busy} mutate={mutate} navigate={navigate} onClose={() => setDemo(false)} onLogin={loginDemo} /> : null}
    <div className="live-region" role="status" aria-live="polite">{busy ? 'Saving…' : ''}</div>
  </div>;
}

function Entry({ state, busy, mutate, onDemo }: { state: AnonymousView; busy: boolean; mutate: Mutate; onDemo: (access: DemoAccess, collectionId?: DemoCollectionId) => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [link, setLink] = useState('');
  const [validation, setValidation] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setValidation('');
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setValidation('Enter your name and a valid email address.'); return; }
    const inviteToken = new URLSearchParams(window.location.search).get('invite') || (window.location.pathname.startsWith('/invite/') ? decodeURIComponent(window.location.pathname.split('/invite/')[1]) : undefined);
    const result = await mutate('/auth/request-link', { name, email, inviteToken });
    if (result) { setSent(true); setLink(result.link || ''); }
  };
  const demoOrganizer = state.demoAccess.find(access => access.inviteToken === 'demo-kasia');
  return <main className={`entry-main ${!sent && state.mode === 'rehearsal' ? 'entry-with-examples' : ''}`} id="main-content">{sent ? <>
    <div className="entry-mail-icon"><Mail size={36} strokeWidth={1.4} /><Check size={17} /></div><h1>Your sign-in link is ready</h1><p className="section-description">Open the bundle as<br /><strong>{email}</strong></p><p className="muted">Open the link to access your bundle. No password needed.</p>{link ? <Button onClick={() => window.location.assign(link)}>Open bundle link</Button> : null}<Button variant="text" busy={busy} onClick={() => { setSent(false); }}>Change email address</Button><p className="caption centered">This version shows your link in the app and does not send an email.</p>
  </> : <>
    <h1>Welcome to LOTSPLIT</h1>
    <p className="entry-purpose">One seller, one whole bundle, different things you each want. Agree on who gets what and have everyone approve the terms before paying.</p>
    <div className="entry-layout">
      <form onSubmit={submit} className="entry-form"><label>Name<input value={name} autoComplete="given-name" placeholder="Your name" onChange={event => setName(event.target.value)} required /></label><label>Email<input value={email} type="email" autoComplete="email" placeholder="you@example.com" onChange={event => setEmail(event.target.value)} required /></label><p className="muted">We will create a link to your bundle.</p>{validation ? <Notice tone="error">{validation}</Notice> : null}<Button type="submit" busy={busy}>Create sign-in link</Button><p className="caption centered">No password needed.</p></form>
      {state.mode === 'rehearsal' ? <section className="demo-entry" aria-labelledby="demo-examples-title"><h2 id="demo-examples-title">Try buying together</h2><p className="caption">Choose an example. You will join as Kasia, the organizer.</p><div className="demo-examples">{DEMO_COLLECTIONS.slice(0, 3).map(collection => <button type="button" className="demo-example" key={collection.id} disabled={busy || !demoOrganizer} onClick={() => { if (demoOrganizer) void onDemo(demoOrganizer, collection.id); }} aria-label={`Try example: ${collection.name}`}><img src={collection.imageUrl} alt="" loading="lazy" /><span className="demo-example-copy"><strong>{collection.name}</strong><span className="demo-example-description">{collection.description}</span><span className="demo-example-action">Try this example <span aria-hidden="true">→</span></span></span></button>)}</div></section> : null}
    </div>
  </>}</main>;
}

const scenarios: { id: RehearsalScenario; label: string; detail: string }[] = [
  { id: 'start', label: 'Start from scratch', detail: 'Catalog awaiting confirmation' },
  { id: 'collecting', label: 'Saved selections', detail: 'Four participants, ready to calculate a plan' },
  { id: 'plan', label: 'Plan ready for review', detail: 'Review allocations and prices' },
  { id: 'agreements', label: 'Participant approvals', detail: 'Plan sent for approval' },
  { id: 'three-authorizations', label: 'Three authorizations', detail: 'Payment capture is still blocked' },
  { id: 'ready', label: 'Ready to capture payments', detail: 'Four valid approvals and authorizations' },
  { id: 'unknown', label: 'Unknown result', detail: 'Maja charged, checking Ola’s payment' },
  { id: 'partial-failure', label: 'Partial failure', detail: 'Refund Maja and cancel remaining authorizations' },
  { id: 'refund-completed', label: 'Refund confirmed', detail: 'Settlement after an unsuccessful purchase' },
  { id: 'success', label: 'Paid allocation', detail: 'Packing list available' },
  { id: 'dropout', label: 'Jan withdraws', detail: 'No complete allocation available' },
  { id: 'v2', label: 'New plan with Ewa', detail: 'Maja’s changes require renewed approval' },
];

function DemoDrawer({ state, onClose, onLogin, mutate, busy, navigate }: { state: AppView; onClose: () => void; onLogin: (access: DemoAccess) => Promise<void>; mutate: Mutate; busy: boolean; navigate: (value: string) => void }) {
  const currentCollectionId = state.rehearsalCollectionId || DEFAULT_DEMO_COLLECTION_ID;
  const [collectionId, setCollectionId] = useState<DemoCollectionId>(currentCollectionId);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener); }, [onClose]);
  return <div className="drawer-backdrop" onClick={onClose}><aside className="demo-drawer" role="dialog" aria-modal="true" aria-labelledby="demo-title" onClick={event => event.stopPropagation()}>
    <div className="drawer-heading"><div><h2 id="demo-title">Try the demo</h2><p className="caption">Simulated payments · separate demo database</p></div><button className="icon-button" onClick={onClose} aria-label="Close demo"><X size={22} /></button></div>
    <Notice>All payments in this demo are simulated. Changing the bundle or scenario replaces the demo data.</Notice>
    <h3>Choose a role</h3>
    <div className="demo-role-list">{roles.map(access => <button disabled={busy} key={access.inviteToken} className={state.authenticated && state.me.name === access.name ? 'is-current' : ''} onClick={() => void onLogin(access)}><strong>{access.name}</strong><span>{access.role === 'organizer' ? 'Organizer' : 'Buyer'}</span>{state.authenticated && state.me.name === access.name ? <Check size={17} /> : null}</button>)}</div>
    {state.authenticated && state.role === 'organizer' ? <>
      <h3>Example bundle</h3>
      <form className="demo-collection-form" onSubmit={async event => { event.preventDefault(); const result = await mutate('/rehearsal/collection', { collectionId }); if (result) { navigate('/'); onClose(); } }}>
        <label className="caption">Choose a bundle<select value={collectionId} disabled={busy} onChange={event => setCollectionId(event.target.value as DemoCollectionId)} aria-describedby="demo-collection-reset">{DEMO_COLLECTIONS.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
        <p className="caption" id="demo-collection-reset">Changing the bundle restarts the demo and replaces selections, approvals and simulated payments.</p>
        <Button type="submit" variant="secondary" busy={busy} disabled={collectionId === currentCollectionId}>Change bundle</Button>
      </form>
      <h3>Choose a demo scenario</h3><div className="scenario-list">{scenarios.map(scenario => <button key={scenario.id} disabled={busy} onClick={async () => { const result = await mutate('/rehearsal/scenario', { scenario: scenario.id }); if (result) { navigate('/'); onClose(); } }}><strong>{scenario.label}</strong><span>{scenario.detail}</span></button>)}</div>
      <h3>Next payment capture result</h3><label className="caption">Use after all four payments are authorized<select value={state.rehearsalCaptureOutcome} disabled={busy} onChange={event => void mutate('/rehearsal/outcome', { outcome: event.target.value })}><option value="success">All payments captured successfully</option><option value="unknown-ola">Unknown result for Ola</option><option value="failure-ola">Confirmed failure for Ola</option></select></label>
    </> : <p className="caption">Switch to Kasia to change bundles, scenarios and payment capture results.</p>}
  </aside></div>;
}
