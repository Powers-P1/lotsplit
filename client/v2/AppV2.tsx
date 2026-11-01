import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, LogOut, X } from 'lucide-react';
import type { AnonymousView, AppView, DemoAccess, RehearsalScenario } from '../../shared/types';
import type { DemoCollectionId } from '../../shared/demo-collections';
import { V2_EXAMPLES } from '../../shared/v2-examples';
import type { useApplication, useRoute } from '../api';
import { B, Heading, Note } from './ui';
import Buyer from './Buyer';
import GuidedDemo from './GuidedDemo';
import './v2.css';
import './guided-demo.css';

const Seller=lazy(()=>import('./Seller'));
type Props={app:ReturnType<typeof useApplication>;routing:ReturnType<typeof useRoute>};
const sellerPages=[['/setup','Lot details'],['/catalog','Catalogue'],['/participants','Buyers and options'],['/assistant','AI checked question'],['/plan','Allocation plan'],['/payments','Payments'],['/pickup','Prepare pickup']];
export default function AppV2({app,routing}:Props){
  const {state,busy,mutate,error,notice,refresh}=app;const {route,navigate}=routing;
  const [menu,setMenu]=useState(false);const [demo,setDemo]=useState(false);
  const [guideRequest,setGuideRequest]=useState(0);
  useEffect(()=>{setMenu(false);},[route]);
  if(!state)return null;
  const signIn=async(access:DemoAccess,collectionId?:DemoCollectionId,next='/')=>{const r=await mutate('/auth/demo',{inviteToken:access.inviteToken,collectionId});if(r){navigate(next);setDemo(false);}};
  const seller=state.authenticated&&state.role==='organizer';
  const openGuide=()=>{if(state.mode==='rehearsal'){setMenu(false);setDemo(false);setGuideRequest(request=>request+1);}};
  const sellerNavigation=state.authenticated&&state.role==='organizer'&&!state.plan&&!state.previousPlan?[['/create','Create a lot'],...sellerPages]:sellerPages;
  return <div className={`v2 ${seller?'v2-seller':'v2-buyer'}`}>
    <a className="v-skip-link" href="#main-content" onClick={event=>{event.preventDefault();const main=document.getElementById('main-content');if(main){main.tabIndex=-1;main.focus();main.scrollIntoView({block:'start'});}}}>Skip to content</a>
    <header className="v-header"><div className="v-header-inner">
      <div className="v-brand-area">{state.authenticated&&!seller&&route!=='/'&&route!=='/collection'?<button className="v-icon-button" aria-label="Back to lot" onClick={()=>navigate('/collection')}><ArrowLeft/></button>:null}<button className="v-brand" onClick={()=>navigate('/')}>LOTSPLIT</button></div>
      {state.authenticated?<div className="v-account"><button className="v-account-trigger" aria-expanded={menu} onClick={()=>setMenu(!menu)}>{state.me.name}<span className="v-account-role"> · {seller?'Seller':'Buyer'}</span><ChevronDown size={18}/></button>{menu?<><button className="v-menu-scrim" aria-label="Close menu" onClick={()=>setMenu(false)}/><nav className="v-menu" aria-label="Navigation">{(seller?sellerNavigation:[['/collection','The whole lot'],['/needs','My basket options'],['/plan','My purchase'],['/payment','My PayPal status']]).map(([path,label])=><button key={path} onClick={()=>{setMenu(false);navigate(path);}}>{label}</button>)}{state.mode==='rehearsal'?<><button onClick={openGuide}>Guided demo</button><button onClick={()=>{setMenu(false);setDemo(true);}}>Demo controls</button></>:null}<button onClick={async()=>{if(await mutate('/auth/logout',{}))navigate('/');}}><LogOut size={16}/>Sign out</button></nav></>:null}</div>:null}
    </div></header>
    <div className="v-mode-label"><span>{state.mode==='sandbox'?'PayPal Sandbox · test money':'Demo · simulated payments'}</span>{state.mode==='rehearsal'?<div className="v-mode-actions"><button id="v-guided-demo-trigger" aria-controls="v-guided-demo" onClick={openGuide}>Guided demo</button><button onClick={()=>setDemo(true)}>Demo controls</button></div>:null}</div>
    {state.mode==='rehearsal'?<GuidedDemo state={state} busy={busy} mutate={mutate} navigate={navigate} route={route} openRequest={guideRequest}/>:null}
    {error?<div className="v-feedback"><Note tone="error"><span>{error}</span><button className="v-close-message" aria-label="Dismiss error" onClick={()=>app.setError(undefined)}><X size={16}/></button></Note></div>:null}
    {notice?<div className="v-feedback"><Note tone="ok">{notice}</Note></div>:null}
    {!state.authenticated?<Entry state={state} busy={busy} mutate={mutate} navigate={navigate} route={route} signIn={signIn}/>:state.role==='organizer'?<Suspense fallback={<div className="v-loading"><Loader2 className="v-spin"/></div>}><Seller key={state.collection.id} state={state} route={route} navigate={navigate} mutate={mutate} busy={busy} refresh={refresh}/></Suspense>:<Buyer key={`${state.collection.id}:${state.me.id}`} state={state} route={route} navigate={navigate} mutate={mutate} busy={busy} refresh={refresh}/>}
    {demo&&state.mode==='rehearsal'?<Demo state={state} busy={busy} mutate={mutate} signIn={signIn} onClose={()=>setDemo(false)} navigate={navigate}/>:null}
    <footer className="v-public-links" aria-label="Project information"><a href="/about">About LOTSPLIT</a><a href="/judges">For judges</a></footer>
    <div className="v-live" role="status" aria-live="polite">{busy?'Saving…':''}</div>
  </div>;
}
function Entry({state,busy,mutate,navigate,route,signIn}:{state:AnonymousView;busy:boolean;mutate:Props['app']['mutate'];navigate:(s:string)=>void;route:string;signIn:(a:DemoAccess,c?:DemoCollectionId,n?:string)=>Promise<void>}){
  const [email,setEmail]=useState('');const [link,setLink]=useState('');
  const invite=new URLSearchParams(window.location.search).get('invite')??(window.location.pathname.startsWith('/invite/')?window.location.pathname.slice(8):'');
  if(route==='/signin'&&state.mode==='sandbox'&&!invite)return <main className="v-narrow" id="main-content"><Heading title="Open your lot" subtitle="Use your private invitation link."/><Note>Sandbox access is limited to invited buyers and the configured seller. Open your complete private link, then enter its matching email address.</Note><B variant="text" onClick={()=>navigate('/')}>Back</B></main>;
  if(route==='/signin'||invite)return <main className="v-narrow" id="main-content"><Heading title="Open your lot" subtitle="Use the email address linked to your invitation."/>
    <form onSubmit={async e=>{e.preventDefault();const r=await mutate('/auth/request-link',{email,inviteToken:invite});if(r?.link)setLink(r.link);}}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/></label><B type="submit" busy={busy}>Create sign-in link</B></form>
    {link?<><Note tone="ok">Your private sign-in link is ready. This prototype shows it here; no email was sent.</Note><B onClick={()=>window.location.assign(link)}>Open lot</B></>:null}
  </main>;
  return <main className="v-entry" id="main-content"><Heading title="Sell the whole lot." subtitle="Agree who takes what. Get paid by each buyer."/>
    <img className="v-hero" src="/assets/v2/hero.png" alt="A mixed workshop lot: tools, furniture and an extension reel"/>
    <B busy={busy} onClick={()=>state.mode==='rehearsal'?void signIn(state.demoAccess.find(a=>a.role==='organizer')!,'workshop','/create'):navigate('/signin')}>{state.mode==='rehearsal'?'Create a lot':'Open your lot'}</B>
    {state.mode==='rehearsal'?<section className="v-examples"><h2>Try an example</h2>{V2_EXAMPLES.slice(0,3).map(example=><button key={example.id} disabled={busy} onClick={()=>void signIn(state.demoAccess.find(a=>a.role==='organizer')!,example.id)}><img src={example.imageUrl} alt=""/><span><strong>{example.name}</strong><small>{example.itemCount} items · {example.buyerCount} buyers</small></span><ChevronRight size={20}/></button>)}</section>:<p className="v-caption">Use your private seller or buyer invitation to sign in. Example resets are available only in the payment rehearsal.</p>}
  </main>;
}
const scenarios:{id:RehearsalScenario;label:string}[]=[{id:'start',label:'Catalogue awaiting review'},{id:'collecting',label:'Confirmed options · run the assistant'},{id:'plan',label:'Full plan to review'},{id:'agreements',label:'Waiting for one approval'},{id:'three-authorizations',label:'Waiting for one hold'},{id:'ready',label:'Ready to collect payments'},{id:'v2',label:'Revised plan · exact holds kept'},{id:'dropout',label:'Lena leaves · no complete plan'},{id:'hold-unknown',label:'Interrupted hold confirmation'},{id:'unknown',label:'Unknown capture result'},{id:'partial-failure',label:'Refund and cancellations pending'},{id:'refund-completed',label:'Refund confirmed'},{id:'success',label:'Paid · waiting for preparation'},{id:'incomplete',label:'Plan check incomplete'},{id:'expired',label:'Reservation ended'}];
function Demo({state,busy,mutate,signIn,onClose,navigate}:{state:AppView;busy:boolean;mutate:Props['app']['mutate'];signIn:(a:DemoAccess,c?:DemoCollectionId,n?:string)=>Promise<void>;onClose:()=>void;navigate:(s:string)=>void}){
  useEffect(()=>{const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[onClose]);
  const access=state.demoAccess??[];
  return <div className="v-modal-backdrop" onClick={onClose}><aside className="v-demo" role="dialog" aria-modal="true" aria-labelledby="v-demo-title" onClick={e=>e.stopPropagation()}><button className="v-demo-close v-icon-button" aria-label="Close demo controls" onClick={onClose}><X/></button><h2 id="v-demo-title">Demo controls</h2><p>Payments here are simulated. Scenarios replace demo data.</p><h3>Choose a role</h3><div className="v-role-list">{access.map(a=><button key={a.inviteToken} disabled={busy} onClick={()=>void signIn(a)}><strong>{a.name}</strong><span>{a.role==='organizer'?'Seller':'Buyer'}</span>{state.authenticated&&state.me.name===a.name?<Check size={16}/>:null}</button>)}</div>
    {state.authenticated&&state.role==='organizer'?<><h3>Example lot</h3><div className="v-demo-examples">{V2_EXAMPLES.map(example=><B key={example.id} variant="text" busy={busy} onClick={async()=>{if(await mutate('/rehearsal/collection',{collectionId:example.id})){navigate('/');onClose();}}}>{example.name}</B>)}</div><h3>Open a scenario</h3>{scenarios.map(s=><button className="v-scenario" key={s.id} disabled={busy||(s.id==='v2'&&state.rehearsalCollectionId!=='workshop')} title={s.id==='v2'&&state.rehearsalCollectionId!=='workshop'?'Choose Workshop clearance for this example.':undefined} onClick={async()=>{if(await mutate('/rehearsal/scenario',{scenario:s.id})){navigate('/');onClose();}}}>{s.label}<ChevronRight size={16}/></button>)}</>:<p className="v-caption">Switch to Alex to choose another scenario.</p>}
  </aside></div>;
}
