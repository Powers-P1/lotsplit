import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LotSplitEngine, DomainError, type DomainState } from './domain.js';
import { SqliteStore } from './store.js';
import { solveWholeBaskets, agentContextDigest } from './v2-rules.js';
import { runBasketAgent } from './basket-agent.js';
import type { BuyerId, OrganizerView, BuyerView } from '../shared/types.js';
import { v2Defaults } from './v2-catalog.js';

const NOW='2026-10-31T09:00:00.000Z';
function fixture(){let clock=new Date(NOW);const store=new SqliteStore<DomainState>(':memory:');
  const engine=new LotSplitEngine(store,{mode:'rehearsal',conceptVersion:2,now:()=>clock});
  return {engine,store,advance:(hours:number)=>{clock=new Date(clock.getTime()+hours*3600_000);}};}
const current=(e:LotSplitEngine)=>{const s=e.snapshot();return s.plans.find(p=>p.id===s.currentPlanId)!;};
const code=(value:string)=>(error:unknown)=>error instanceof DomainError&&error.code===value;
function save(e:LotSplitEngine,id:BuyerId,baskets:string[][],budget:number){e.saveBasketOptions(id,{basketOptions:baskets,budgetCents:budget,confirmed:true});}

test('V2 starts with 12 independently priced items, four active buyers, one pickup and an empty private budget',()=>{
  const {engine:e,store}=fixture();try{const s=e.snapshot();assert.equal(s.collection.items.length,12);assert.equal(s.collection.totalCents,180000);
    assert.equal(s.participants.filter(p=>p.active).length,4);assert.ok(s.collection.pickup);assert.equal(s.collection.sharedCostCents,0);
    assert.equal(e.view().conceptVersion,2);assert.equal(e.sessionUser('kasia').name,'Alex');}finally{store.close();}});

test('V2 only assigns complete human-confirmed baskets, supports unequal counts and cannot treat a saved option as consent',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');e.solve('kasia');assert.equal(e.snapshot().noSolution?.code,'NO_ALLOCATION');
    save(e,'ola',[['01','02','03'],['04','12']],50000);e.solve('kasia');const p=current(e);
    assert.deepEqual(p.assignments.map(a=>[a.buyerId,a.itemIds.length,a.totalCents]),[['maja',3,38000],['ola',2,19000],['bartek',4,72000],['jan',3,51000]]);
    assert.equal(new Set(p.assignments.flatMap(a=>a.itemIds)).size,12);assert.deepEqual(p.consents,{});assert.deepEqual(p.payments,{});
    assert.equal(e.view('ola').gates.authorize.allowed,false);assert.equal(Object.keys(e.snapshot().operations).length,0);
  }finally{store.close();}});

test('V2 rejects empty, duplicate, over-limit and unconfirmed baskets without changing the saved state',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');const before=e.snapshot();
    assert.throws(()=>save(e,'ola',[[]],50000),code('EMPTY_BASKET'));
    assert.throws(()=>save(e,'ola',[['01'],['01']],50000),code('DUPLICATE_OPTION'));
    assert.throws(()=>save(e,'ola',[['01','02','03']],100),code('BUDGET_LIMIT'));
    assert.throws(()=>e.saveBasketOptions('ola',{basketOptions:[['04','12']],budgetCents:50000}),code('CONFIRM_OPTIONS'));
    assert.deepEqual(e.snapshot(),before);
  }finally{store.close();}});

test('V2 private budget and raw description never reach the organizer or another buyer, while fixed item prices are public',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');e.saveBasketOptions('ola',{basketOptions:[['04','12']],budgetCents:54321,description:'My secret limit is 54321.',confirmed:true});e.solve('kasia');
    const organizer=e.view('kasia') as OrganizerView;const other=e.view('maja') as BuyerView;
    assert.equal(JSON.stringify(organizer).includes('54321'),false);assert.equal(JSON.stringify(other).includes('54321'),false);
    assert.equal(other.collection.items.find(i=>i.id==='04')?.fixedPriceCents,14000);assert.equal((e.view('ola') as BuyerView).participant.preferences?.budgetCents,54321);
  }finally{store.close();}});

test('V2 agent reads and checks tools but cannot save an option or send a question without separate human actions',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');const before=e.snapshot();const response=await runBasketAgent(e);
    assert.ok(response.question);assert.equal(response.question.buyerId,'ola');assert.deepEqual(response.question.itemIds,['04','12']);
    assert.deepEqual(response.toolCalls.map(c=>c.name),['read_catalog','read_conditions','check_plan','check_candidate','compare_plan']);assert.deepEqual(e.snapshot(),before);
    e.storeCheckedQuestion('kasia',response.question,response.context);assert.equal((e.view('ola') as BuyerView).agentQuestion,undefined);
    const q=e.snapshot().agentQuestion!;assert.throws(()=>e.sendQuestion('ola',q.id),code('FORBIDDEN'));
    e.sendQuestion('kasia',q.id);assert.equal((e.view('ola') as BuyerView).agentQuestion?.status,'sent');
    assert.throws(()=>e.answerQuestion('maja',q.id,true),code('STALE_QUESTION'));
    e.answerQuestion('ola',q.id,true);assert.equal(e.snapshot().participants.find(p=>p.id==='ola')!.preferences!.basketOptions!.length,2);
    assert.equal(Object.keys(e.snapshot().operations).length,0);e.solve('kasia');assert.equal(current(e).assignments.length,4);
  }finally{store.close();}});

test('V2 rejects stale questions and preserves a refusal without widening buyer options',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');let r=await runBasketAgent(e);e.storeCheckedQuestion('kasia',r.question!,r.context);let q=e.snapshot().agentQuestion!;e.sendQuestion('kasia',q.id);
    e.answerQuestion('ola',q.id,false);assert.equal(e.snapshot().participants.find(p=>p.id==='ola')!.preferences!.basketOptions!.length,1);
    r=await runBasketAgent(e);e.storeCheckedQuestion('kasia',r.question!,r.context);q=e.snapshot().agentQuestion!;e.sendQuestion('kasia',q.id);
    save(e,'maja',[['01','02','03']],46000);assert.throws(()=>e.answerQuestion('ola',q.id,true),code('STALE_QUESTION'));
  }finally{store.close();}});

test('V2 all consents gate exact authorizations; no delivery address is required for one pickup',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','agreements');assert.equal(e.view('ola').gates.authorize.allowed,false);
    const p=current(e);e.agree('bartek',p.id,p.assignments.find(a=>a.buyerId==='bartek')!.termsDigest);
    const o=await e.authorize('ola',p.id);await e.approve('ola',o.operationId);const v=e.view('ola') as BuyerView;
    assert.equal(v.plan?.payment.authorization?.amountCents,19000);assert.equal(v.plan?.payment.authorization?.status,'AUTHORIZED');assert.equal(v.participant.address,undefined);
    assert.equal(v.gates.capture.allowed,false);assert.equal(v.paymentDeadline,'2026-11-01T09:00:00.000Z');
  }finally{store.close();}});

test('V2 changed and withdrawn holds are voided; exact unchanged V2 consent AND authorization survive repair',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','v2');const p=current(e);const s=e.snapshot();
    assert.equal(p.version,2);assert.deepEqual(p.assignments.map(a=>[a.buyerId,a.itemIds.length,a.totalCents]),[['maja',3,38000],['ola',4,43000],['ewa',2,48000],['jan',3,51000]]);
    assert.ok(p.consents.maja?.preservedFromPlanId);assert.ok(p.consents.jan?.preservedFromPlanId);assert.equal(p.consents.ola,undefined);assert.equal(p.consents.ewa,undefined);
    assert.equal(s.operations[p.payments.maja!.authorizationOperationId!].status,'AUTHORIZED');assert.equal(s.operations[p.payments.jan!.authorizationOperationId!].status,'AUTHORIZED');
    assert.equal(p.payments.ola,undefined);assert.equal(p.payments.ewa,undefined);
    assert.deepEqual(Object.values(s.operations).filter(o=>o.kind==='void').map(o=>[o.buyerId,o.amountCents,o.status]).sort(),[['bartek',72000,'VOIDED'],['ola',19000,'VOIDED']].sort());
    assert.equal((e.view('kasia') as OrganizerView).priorPaymentBlockers.length,0);
    e.sendPlan('kasia',p.id);for(const id of ['ola','ewa'] as BuyerId[]){const a=p.assignments.find(x=>x.buyerId===id)!;e.agree(id,p.id,a.termsDigest);}
    for(const id of ['ola','ewa'] as BuyerId[]){const o=await e.authorize(id,p.id);await e.approve(id,o.operationId);}
    assert.equal(e.view('kasia').gates.capture.allowed,true);await e.capture('kasia',p.id);assert.equal(current(e).status,'paid');
    assert.equal(e.snapshot().operations[p.payments.maja!.authorizationOperationId!].status,'AUTHORIZED');
    assert.equal(Object.values(e.snapshot().operations).filter(o=>o.kind==='capture').reduce((sum,o)=>sum+o.amountCents,0),180000);
  }finally{store.close();}});

test('V2 shared pickup changes invalidate all commitments; old contracts never get authorization preservation',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','ready');const s=e.snapshot();const p=current(e);const revision=s.revision;
    delete s.plans[0].consents.maja!.contract;s.revision++;store.save(s,revision);
    e.updateCollection('kasia',{pickup:{...s.collection.pickup,location:'A different pickup address'}});e.solve('kasia');await e.processPendingCompensation();
    assert.deepEqual(current(e).consents,{});assert.deepEqual(current(e).payments,{});assert.notEqual(p.assignments[0].termsDigest,current(e).assignments[0].termsDigest);
  }finally{store.close();}});

test('V2 expiry starts at first authorization, survives reads, blocks captures and requests cancellation without claiming confirmation',async()=>{
  const {engine:e,store,advance}=fixture();try{await e.setScenario('kasia','ready');advance(25);assert.equal(e.view('kasia').reservationExpired,true);
    const before=e.snapshot();e.view('kasia');assert.deepEqual(e.snapshot(),before);assert.equal(e.view('kasia').gates.capture.allowed,false);
    await e.expireReservations();assert.equal(current(e).status,'invalidated');assert.equal(Object.values(e.snapshot().operations).filter(o=>o.kind==='void').length,4);
    assert.ok(Object.values(e.snapshot().operations).filter(o=>o.kind==='void').every(o=>o.status==='PENDING'));
    await e.reconcile('kasia');assert.ok(Object.values(e.snapshot().operations).filter(o=>o.kind==='void').every(o=>o.status==='VOIDED'));
  }finally{store.close();}});

test('V2 partial failure keeps refund and void pending, stops later captures and blocks physical preparation',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','partial-failure');const s=e.snapshot();assert.equal(current(e).status,'failed');
    assert.equal(Object.values(s.operations).filter(o=>o.kind==='capture').length,2);assert.deepEqual(Object.values(s.operations).filter(o=>o.kind==='refund').map(o=>[o.amountCents,o.status]),[[38000,'PENDING']]);
    assert.equal(Object.values(s.operations).filter(o=>o.kind==='void').reduce((sum,o)=>sum+o.amountCents,0),142000);assert.equal(e.view('kasia').gates.packing.allowed,false);
    await e.reconcile('kasia');assert.ok(Object.values(e.snapshot().operations).filter(o=>o.kind==='refund').every(o=>o.status==='COMPLETED'));
  }finally{store.close();}});

test('V2 unknown capture reconciles the same operations and never starts another capture before resolution',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','unknown');const before=e.snapshot();assert.equal(current(e).status,'reconciling');
    assert.equal(Object.values(before.operations).filter(o=>o.kind==='capture').length,2);await e.capture('kasia',current(e).id);
    assert.equal(Object.values(e.snapshot().operations).filter(o=>o.kind==='capture').length,2);await e.reconcile('kasia');
    assert.equal(Object.values(e.snapshot().operations).filter(o=>o.kind==='capture').length,2);assert.equal(current(e).status,'failed');
  }finally{store.close();}});

test('V2 physical preparation checks actual basket length after all captures; paid never means prepared',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','success');assert.equal(e.view('kasia').gates.packing.allowed,true);
    assert.ok(e.snapshot().packing.every(p=>!p.packedAt));assert.throws(()=>e.updatePacking('kasia','ola',{checkedItemIds:['04'],packed:true}),code('PACKING_INCOMPLETE'));
    e.updatePacking('kasia','ola',{checkedItemIds:['04','12'],packed:true});assert.ok(e.snapshot().packing.find(p=>p.buyerId==='ola')!.packedAt);
  }finally{store.close();}});

test('V2 finished infeasibility and incomplete checks remain distinct with no fake global budget gap',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','v2');save(e,'ola',[['04','12']],50000);e.solve('kasia');
    assert.equal(e.snapshot().noSolution?.code,'NO_ALLOCATION');assert.deepEqual(e.snapshot().noSolution?.unassignedItemIds,['06','08']);
    const s=e.snapshot();const incomplete=solveWholeBaskets(s.collection,s.participants,[],0);assert.equal(Array.isArray(incomplete),false);
    if(!Array.isArray(incomplete)){assert.equal(incomplete.code,'INCOMPLETE');assert.deepEqual(incomplete.unassignedItemIds,[]);}
  }finally{store.close();}});

for(const [id,count,buyers] of [['office',15,4],['home',9,3],['cafe',18,5]] as const)test(`V2 ${id} has distinct inventory and a complete unequal-basket purchase for ${buyers} buyers`,async()=>{
  const {engine:e,store}=fixture();try{e.setRehearsalCollection('kasia',id);await e.setScenario('kasia','success');
    assert.equal(e.snapshot().collection.items.length,count);assert.equal(current(e).assignments.length,buyers);assert.equal(current(e).status,'paid');
    assert.equal(new Set(current(e).assignments.flatMap(a=>a.itemIds)).size,count);
  }finally{store.close();}});

test('V2 own lot starts empty, supports manual items and 2–6 buyer setup, locks fixed prices before budgets',()=>{
  const {engine:e,store}=fixture();try{e.createLot('kasia',{name:'Own mixed sale',buyerCount:2,collectionPriceCents:30000,photos:['/assets/v2/hero.png'],reservationExpiresAt:'2026-11-02T18:00:00Z',pickup:{location:'Test location',startsAt:'2026-11-03T10:00:00Z',endsAt:'2026-11-03T12:00:00Z'}});
    assert.equal(e.snapshot().collection.items.length,0);e.addItem('kasia',{name:'Desk',shareCents:20000});e.addItem('kasia',{name:'Lamp',shareCents:10000});
    for(const i of e.snapshot().collection.items)e.updateItem('kasia',i.id,{confirmed:true});e.confirmCatalog('kasia');
    assert.throws(()=>e.updateItem('kasia','01',{shareCents:19000}),code('SHARES_LOCKED'));
    save(e,'maja',[['01']],25000);save(e,'ola',[['02']],15000);e.solve('kasia');assert.equal(current(e).assignments.length,2);
  }finally{store.close();}});

test('V2 respects explicit rejected goods in the solver and in new checked questions',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');assert.equal(e.checkCandidate('maja',['04','12']).feasible,false);
    assert.throws(()=>e.saveBasketOptions('maja',{basketOptions:[['04','12']],rejectedItemIds:['04'],budgetCents:45000,confirmed:true}),code('REJECTED_ITEM'));
    const result=await runBasketAgent(e);assert.equal(result.question?.buyerId,'ola');
  }finally{store.close();}});

test('V2 six independent buyers can cover a six-item own lot without any equal-count constraint or implicit consent',()=>{
  const {engine:e,store}=fixture();try{e.createLot('kasia',{name:'Six buyer sale',buyerCount:6,collectionPriceCents:60000,photos:['/assets/v2/hero.png'],reservationExpiresAt:'2026-11-02T18:00:00Z',pickup:{location:'Test',startsAt:'2026-11-03T10:00:00Z',endsAt:'2026-11-03T12:00:00Z'}});
    for(let i=0;i<6;i++)e.addItem('kasia',{name:`Item ${i+1}`,shareCents:10000});for(const i of e.snapshot().collection.items)e.updateItem('kasia',i.id,{confirmed:true});e.confirmCatalog('kasia');
    for(const [index,p]of e.snapshot().participants.entries())save(e,p.id,[[String(index+1).padStart(2,'0')]],15000);e.solve('kasia');assert.equal(current(e).assignments.length,6);assert.deepEqual(current(e).consents,{});
  }finally{store.close();}});

test('V2 seller cannot replace an active buyer or reuse an already-replaced slot',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');await assert.rejects(e.replace('kasia','bartek','ewa'),code('WITHDRAWAL_REQUIRED'));
    await e.withdraw('bartek');await e.replace('kasia','bartek','ewa');await assert.rejects(e.replace('kasia','bartek','sixth'),code('WITHDRAWAL_REQUIRED'));await assert.rejects(e.withdraw('bartek'),code('INACTIVE'));
    assert.equal(e.snapshot().participants.filter(p=>p.active).length,4);
  }finally{store.close();}});

test('V2 cannot open a zero-price payment basket even when item prices add up',()=>{
  const {engine:e,store}=fixture();try{const first=e.snapshot().collection.items[0];const second=e.snapshot().collection.items[1];
    e.updateItem('kasia',first.id,{shareCents:0});e.updateItem('kasia',second.id,{shareCents:first.shareCents+second.shareCents});
    for(const i of e.snapshot().collection.items)e.updateItem('kasia',i.id,{confirmed:true});
    assert.throws(()=>e.confirmCatalog('kasia'),code('FIXED_PRICE_REQUIRED'));assert.equal(e.snapshot().collection.preferencesOpened,false);
  }finally{store.close();}});

test('V2 uploaded-photo regions reject invalid coordinates without mutating inventory',()=>{
  const {engine:e,store}=fixture();try{const before=e.snapshot();
    for(const region of [{x:-.1,y:0,width:.3,height:.3},{x:.9,y:0,width:.3,height:.3},{x:0,y:0,width:0,height:.3},{x:0,y:0,width:Number.NaN,height:.3}])
      assert.throws(()=>e.updateItem('kasia','01',{imageRegion:region}),code('INVALID_IMAGE_REGION'));
    assert.deepEqual(e.snapshot(),before);e.updateItem('kasia','01',{imageRegion:{x:.1,y:.2,width:.3,height:.4}});
    assert.deepEqual(e.snapshot().collection.items[0].imageRegion,{x:.1,y:.2,width:.3,height:.4});e.updateItem('kasia','01',{imageRegion:null});assert.equal(e.snapshot().collection.items[0].imageRegion,undefined);
  }finally{store.close();}});

test('V2 demo role names follow human-edited identities without exposing private preferences',()=>{
  const {engine:e,store}=fixture();try{e.updateParticipant('kasia','maja',{name:'Alice',email:'alice@lotsplit.example'});
    assert.equal(e.view().demoAccess?.find(a=>a.inviteToken==='demo-maja')?.name,'Alice');assert.equal(e.sessionUser('maja').name,'Alice');
  }finally{store.close();}});

test('V2 interrupted hold fixture reconciles and resumes its existing order without a second payment attempt',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','hold-unknown');const p=current(e);const before=Object.values(e.snapshot().operations);
    assert.equal(before.length,1);assert.equal(before[0].status,'UNKNOWN');assert.equal(e.view('maja').gates.capture.allowed,false);
    await e.reconcile('maja',before[0].id);const resumed=await e.authorize('maja',p.id);assert.equal(resumed.operationId,before[0].id);
    const after=Object.values(e.snapshot().operations);assert.equal(after.length,1);assert.equal(after[0].idempotencyKey,before[0].idempotencyKey);assert.equal(after[0].kind,'order');
  }finally{store.close();}});

test('V2 assistant reports a complete garage or office plan without inventing a conflict or changing state',async()=>{
  for(const id of ['home','office'] as const){const {engine:e,store}=fixture();try{e.setRehearsalCollection('kasia',id);await e.setScenario('kasia','collecting');const before=e.snapshot();
    assert.equal((e.view('kasia') as OrganizerView).planCheck?.status,'complete');assert.deepEqual(e.snapshot(),before);
    assert.equal((e.view('maja') as BuyerView).hasOwnProperty('planCheck'),false);
  }finally{store.close();}}
});

test('V2 assistant checks both whole options and only claims a blocker after an exhaustive check',async()=>{
  const {engine:e,store}=fixture();try{await e.setScenario('kasia','collecting');assert.equal((e.view('kasia') as OrganizerView).planCheck?.status,'blocked');
    save(e,'ola',[['01','02','03'],['04','12']],50000);assert.equal((e.view('kasia') as OrganizerView).planCheck?.status,'complete');
    await e.setScenario('kasia','incomplete');assert.equal((e.view('kasia') as OrganizerView).planCheck?.status,'incomplete');
    await e.setScenario('kasia','success');assert.equal((e.view('kasia') as OrganizerView).planCheck?.status,'closed');
  }finally{store.close();}
});

test('V2 rejects incompatible repair shortcuts before resetting or mutating any saved data',async()=>{
  const {engine:e,store}=fixture();try{e.setRehearsalCollection('kasia','office');await e.setScenario('kasia','plan');const before=e.snapshot();
    await assert.rejects(e.setScenario('kasia','v2'),code('WORKSHOP_SCENARIO'));assert.deepEqual(e.snapshot(),before);
  }finally{store.close();}
});
