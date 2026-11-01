import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AppView, DemoAccess, OrganizerView } from '../../shared/types';
import type { Mutate } from '../api';
import { B } from './ui';

type Step = 1 | 2 | 3 | 4 | 5;
type TourProgress = { version: 1; open: boolean; phase: 'welcome' | 'tour'; step: Step; skipped: Step[] };
type Props = { state: AppView; busy: boolean; mutate: Mutate; navigate: (path: string) => void; route: string; openRequest: number };
const storageKey = 'lotsplit:guided-demo:v1';
const steps = ['Check a question', 'Let the buyer decide', 'Send a complete plan', 'Simulate collection', 'See selective repair'];
const initialProgress = (): TourProgress => ({ version: 1, open: false, phase: 'welcome', step: 1, skipped: [] });
const isStep = (value: unknown): value is Step => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

function readProgress(): TourProgress {
  const initial = initialProgress();
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as Partial<TourProgress> | null;
    if (saved?.version === 1 && typeof saved.open === 'boolean' && (saved.phase === 'welcome' || saved.phase === 'tour') && isStep(saved.step)) {
      initial.open = saved.open;
      initial.phase = saved.phase;
      initial.step = saved.step;
      initial.skipped = Array.isArray(saved.skipped) ? [...new Set(saved.skipped.filter(isStep))] : [];
    }
  } catch { /* A blocked or invalid session store must not stop the app. */ }
  if (new URLSearchParams(window.location.search).get('guide') === '1') initial.open = true;
  return initial;
}

function isSeller(state: AppView): state is OrganizerView {
  return state.mode === 'rehearsal' && state.authenticated && state.role === 'organizer';
}

/** The tour observes the application. Only clearly labelled user clicks load prepared demo data. */
export default function GuidedDemo({ state, busy, mutate, navigate, route, openRequest }: Props) {
  const [progress, setProgress] = useState(readProgress);
  const [pending, setPending] = useState(false);
  const [screenRequest, setScreenRequest] = useState<{ path: string; sequence: number }>();
  const title = useRef<HTMLHeadingElement>(null);
  const lastOpenRequest = useRef(openRequest);
  const actionRunning = useRef(false);
  const mode = useRef(state.mode);
  mode.current = state.mode;

  useEffect(() => {
    if (state.mode !== 'rehearsal') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('guide') !== '1') return;
    url.searchParams.delete('guide');
    // Consume the entry request so a closed guide stays closed after a reload.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [state.mode]);
  useEffect(() => {
    if (lastOpenRequest.current === openRequest) return;
    lastOpenRequest.current = openRequest;
    setProgress(current => ({ ...current, open: true }));
  }, [openRequest]);
  useEffect(() => {
    if (state.mode !== 'rehearsal') return;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* Session storage is optional. */ }
  }, [progress, state.mode]);
  useEffect(() => {
    if (!progress.open) return;
    const frame = window.requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [progress.open, progress.phase, progress.step, openRequest]);
  useEffect(() => {
    if (!screenRequest || route !== screenRequest.path) return;
    const frame = window.requestAnimationFrame(() => {
      const main = document.getElementById('main-content');
      if (!main) return;
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
      main.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route, screenRequest]);

  if (state.mode !== 'rehearsal') return null;
  const seller = isSeller(state) ? state : undefined;
  const workshop = state.authenticated && state.rehearsalCollectionId === 'workshop';
  const question = state.authenticated ? state.agentQuestion : undefined;
  const access = state.demoAccess ?? [];
  const sellerAccess = access.find(person => person.role === 'organizer');
  // The display name Jan belongs to demo-ola in the existing seed. Follow the actual checked recipient.
  const buyerAccess = question ? access.find(person => person.inviteToken === `demo-${question.buyerId}`) : access.find(person => person.role === 'buyer' && person.name === 'Jan');
  const answered = question?.status === 'accepted' || question?.status === 'declined';
  const planSent = state.authenticated && !!state.plan && !['draft', 'invalidated'].includes(state.plan.status);
  const paid = state.authenticated && state.plan?.status === 'paid';
  const repaired = !!seller?.previousPlan && seller.plan?.version === 2;
  const canContinue = progress.step === 1 ? !!question?.checked : progress.step === 2 ? !!seller && answered : progress.step === 3 ? planSent : progress.step === 4 ? paid : repaired;
  const disabled = busy || pending;

  const showScreen = (path: string) => {
    navigate(path);
    setScreenRequest(current => ({ path, sequence: (current?.sequence ?? 0) + 1 }));
  };
  const close = () => {
    setProgress(current => ({ ...current, open: false }));
    document.getElementById('v-guided-demo-trigger')?.focus({ preventScroll: true });
  };
  const restart = () => setProgress({ ...initialProgress(), open: true });
  const run = async (action: () => Promise<void>) => {
    if (mode.current !== 'rehearsal' || actionRunning.current || busy) return;
    actionRunning.current = true;
    setPending(true);
    try { await action(); } finally { actionRunning.current = false; setPending(false); }
  };
  const switchRole = (person: DemoAccess, path: string) => void run(async () => {
    const result = await mutate('/auth/demo', { inviteToken: person.inviteToken });
    if (result?.state.mode === 'rehearsal' && mode.current === 'rehearsal') showScreen(path);
  });
  const start = () => void run(async () => {
    if (!sellerAccess) return;
    const signedIn = await mutate('/auth/demo', { inviteToken: sellerAccess.inviteToken, collectionId: 'workshop' });
    if (!signedIn || !isSeller(signedIn.state) || mode.current !== 'rehearsal') return;
    const prepared = await mutate('/rehearsal/scenario', { scenario: 'collecting' });
    if (!prepared || !isSeller(prepared.state) || mode.current !== 'rehearsal') return;
    setProgress(current => ({ ...initialProgress(), open: current.open, phase: 'tour' }));
    showScreen('/assistant');
  });
  const loadScenario = (scenario: 'ready' | 'v2') => void run(async () => {
    if (!seller || !workshop || (scenario === 'v2' && !paid)) return;
    const result = await mutate('/rehearsal/scenario', { scenario });
    if (result && isSeller(result.state) && mode.current === 'rehearsal') showScreen(scenario === 'ready' ? '/payments' : '/plan');
  });
  const next = () => {
    if (!canContinue || progress.step === 5) return;
    setProgress(current => ({ ...current, step: (current.step + 1) as Step, skipped: current.skipped.filter(step => step !== current.step) }));
  };
  const skip = () => {
    setProgress(current => ({ ...current, open: current.step !== 5, step: current.step < 5 ? (current.step + 1) as Step : 5, skipped: [...new Set([...current.skipped, current.step])] }));
    if (progress.step === 5) document.getElementById('v-guided-demo-trigger')?.focus({ preventScroll: true });
  };

  if (!progress.open) return null;
  return <section id="v-guided-demo" className="v-guided-demo" aria-labelledby="v-guided-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
    <div className="v-guide-heading">
      <h2 id="v-guided-title" ref={title} tabIndex={-1}>Guided demo <span>· {progress.phase === 'welcome' ? 'about 5 minutes' : `Step ${progress.step} of 5`}</span></h2>
      <button type="button" className="v-guide-close" aria-label="Close guided demo" onClick={close}><X size={18}/></button>
    </div>
    {progress.phase === 'welcome' ? <>
      <p>Try one checked question, a buyer’s decision, a complete plan, simulated payments and selective repair.</p>
      <p className="v-guide-detail">Starting replaces the shared disposable demo data with Workshop clearance and signs you in as the seller. Payments are simulated. Opening this guide does not approve a purchase or collect payment.</p>
      <div className="v-guide-actions"><B busy={disabled} disabled={!sellerAccess} onClick={start}>Start guided demo</B><B variant="text" onClick={close}>Explore on my own</B></div>
    </> : <>
      <ol className="v-guide-progress" aria-label="Tour steps">{steps.map((label, index) => <li key={label} aria-current={progress.step === index + 1 ? 'step' : undefined}><span>{index + 1}</span><span>{label}{progress.skipped.includes((index + 1) as Step) ? ' · skipped' : ''}</span></li>)}</ol>
      {!workshop ? <>
        <p>This tour uses Workshop clearance. Restart the guide, then choose Start guided demo to load its disposable sample data.</p>
        <div className="v-guide-actions"><B onClick={restart}>Return to demo welcome</B></div>
      </> : <>
        <div className="v-guide-instruction">
          {progress.step === 1 ? <>
            {!question?.checked ? <p>Use <strong>Check with AI</strong> in the seller’s assistant, then inspect the basket and question. The guide does not run the request.</p> : null}
            <p className="v-guide-status" role="status">{question?.checked ? `A checked question for ${question.buyerName} is available.${question.source === 'rehearsal' ? ' It is labelled as a prepared example; no AI service was called.' : ''}` : 'Waiting for a checked question in the application.'}</p>
            <div className="v-guide-actions">{seller ? route !== '/assistant' ? <B variant="secondary" onClick={() => showScreen('/assistant')}>Show the assistant</B> : null : sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/assistant')}>Switch to seller</B> : null}</div>
          </> : progress.step === 2 ? <>
            {!answered && (seller || question) ? <p>{seller ? question?.status === 'sent' ? <>Switch to {buyerAccess?.name ?? 'Jan'}. The buyer chooses <strong>Add this option</strong> or <strong>Keep my original choice</strong>, then returns to the seller.</> : <>Use the seller’s <strong>Send question</strong> action, then switch to {buyerAccess?.name ?? 'Jan'} to answer it.</> : <>Choose <strong>Add this option</strong> or <strong>Keep my original choice</strong> below, then return to the seller.</>}</p> : null}
            <p className="v-guide-status" role="status">{seller ? answered ? `${question!.buyerName} ${question!.status === 'accepted' ? 'accepted the extra basket option' : 'declined the extra basket option'}. Purchase approval is a separate step.` : question?.status === 'sent' ? 'The question is sent. The buyer still decides.' : 'Waiting for the seller to send the checked question.' : question?.status === 'sent' ? 'The question is ready below. Choose your answer in the application.' : 'Return to the seller to check the saved response.'}</p>
            <div className="v-guide-actions">{seller ? <>{!answered && route !== '/assistant' ? <B variant="secondary" onClick={() => showScreen('/assistant')}>Show the question</B> : null}{question?.status === 'sent' && buyerAccess ? <B busy={disabled} onClick={() => switchRole(buyerAccess, '/question')}>Switch to {buyerAccess.name} · buyer</B> : null}</> : <>{question && route !== '/question' ? <B variant="secondary" onClick={() => showScreen('/question')}>Show my question</B> : null}{sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/assistant')}>Return to seller</B> : null}</>}</div>
          </> : progress.step === 3 ? <>
            {!planSent ? <p>{seller ? <>Check the complete allocation, review every basket, then use <strong>Send plan for approval</strong>. Buyers approve their exact purchases separately.</> : <>Your buyer workspace shows your exact purchase. Return to the seller to review and send the complete allocation.</>}</p> : null}
            <p className="v-guide-status" role="status">{planSent ? 'The application confirms that the plan was sent for approval.' : seller?.plan?.status === 'draft' ? 'A draft plan is ready to review. It has not been sent.' : question?.status === 'declined' ? 'The extra option was declined. Review the original choices or check another question; a complete plan is still required. You can skip this tour step to try the prepared payment example.' : 'Waiting for a complete plan to be checked, reviewed and sent.'}</p>
            <div className="v-guide-actions">{seller ? seller.plan && seller.plan.status !== 'invalidated' ? route !== '/plan' && !planSent ? <B variant="secondary" onClick={() => showScreen('/plan')}>Show the plan</B> : null : route !== '/participants' ? <B variant="secondary" onClick={() => showScreen('/participants')}>Show complete-plan check</B> : null : sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/participants')}>Return to seller</B> : null}{seller && !seller.plan && question?.status === 'declined' ? <B variant="text" onClick={() => showScreen('/assistant')}>Return to the assistant</B> : null}</div>
          </> : progress.step === 4 ? <>
            {!paid && !seller?.gates.capture.allowed ? <p>Load a prepared payment example. It replaces sample data with synthetic approvals and simulated holds. Then use the application’s <strong>Collect payments</strong> button.</p> : null}
            <p className="v-guide-status" role="status">{paid ? 'All simulated payments are confirmed. No real money moved.' : seller?.gates.capture.allowed ? 'The application is ready to collect simulated payments. Nothing is collected until you click Collect payments.' : 'Waiting for a payment-ready example or for the group’s approvals and holds.'}</p>
            <div className="v-guide-actions">{seller ? <>{!paid && !seller.gates.capture.allowed ? <B busy={disabled} onClick={() => loadScenario('ready')}>Load simulated payment step</B> : null}{route !== '/payments' && !paid ? <B variant="secondary" onClick={() => showScreen('/payments')}>Show payment controls</B> : null}</> : sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/payments')}>Return to seller</B> : null}</div>
          </> : <>
            {!seller ? <>
              <p>You are viewing a buyer’s purchase. Return to the seller to inspect which baskets and commitments were kept or changed.</p>
              <p className="v-guide-status" role="status">{state.authenticated && state.plan ? 'Your current purchase is Plan ' + state.plan.version + '.' : 'The seller view shows whether a repair has been loaded.'}</p>
              <div className="v-guide-actions">{sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/plan')}>Return to seller</B> : null}</div>
            </> : repaired ? <>
              <p className="v-guide-status" role="status"><strong>{progress.skipped.length ? 'Selective repair is visible.' : 'Guided demo complete.'}</strong> Plan {seller!.plan!.version} has a previous plan. {seller!.plan!.assignments.filter(assignment => assignment.consent?.preservedFromPlanId && assignment.payment.authorization?.status === 'AUTHORIZED' && !assignment.payment.void).map(assignment => assignment.buyerName).join(' and ') || 'No buyers'} kept exact approvals and holds. {seller!.plan!.assignments.filter(assignment => !assignment.consent?.preservedFromPlanId).map(assignment => assignment.buyerName).join(' and ') || 'No buyers'} need new commitments.</p>
              {route !== '/plan' ? <div className="v-guide-actions"><B variant="secondary" onClick={() => showScreen('/plan')}>Inspect kept and changed baskets</B></div> : null}
            </> : <>
              {paid ? <p>Load a prepared second plan with synthetic earlier approvals and holds. It replaces sample data: Marta and Oskar stay unchanged; Jan and Nina need new commitments.</p> : null}
              <p className="v-guide-status" role="status">{paid ? 'The simulated purchase is paid. The prepared repair example can now be loaded.' : 'First finish simulated payment collection in step 4. The repair example has not been loaded.'}</p>
              <div className="v-guide-actions">{seller && paid ? <B busy={disabled} onClick={() => loadScenario('v2')}>See selective repair</B> : !seller && sellerAccess ? <B busy={disabled} onClick={() => switchRole(sellerAccess, '/payments')}>Return to seller</B> : <B variant="secondary" onClick={() => setProgress(current => ({ ...current, step: 4 }))}>Return to simulated payments</B>}</div>
            </>}
          </>}
        </div>
        <div className="v-guide-navigation">
          {progress.step > 1 ? <B variant="text" disabled={disabled} onClick={() => setProgress(current => ({ ...current, step: (current.step - 1) as Step }))}>Previous step</B> : null}
          {progress.step < 5 ? <B busy={disabled} disabled={!canContinue} onClick={next}>Continue to step {progress.step + 1}</B> : null}
          {!(progress.step === 5 && repaired) ? <B variant="text" disabled={disabled} onClick={skip}>{progress.step < 5 ? 'Skip step' : 'Skip and close'}</B> : null}
          <B variant="text" disabled={disabled} onClick={restart}>Restart guide</B>
          <B variant="text" onClick={close}>Close guide</B>
        </div>
        {progress.skipped.length ? <p className="v-guide-detail">Skipped tour steps: {progress.skipped.join(', ')}. Skipping changes only the guide; it does not perform or complete an application action.</p> : null}
      </>}
    </>}
  </section>;
}
