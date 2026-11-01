import { DomainError, type LotSplitEngine } from './domain.js';
import type { AiProvider, AiTrace } from './ai.js';
import type { BuyerId, CheckedQuestion } from '../shared/types.js';
import { agentContextDigest, solveWholeBaskets } from './v2-rules.js';

/** Local tools return facts. No tool can accept baskets, consent, pay, or send an invitation. */
export async function runBasketAgent(engine:LotSplitEngine, provider?:AiProvider) {
  const state=engine.snapshot();
  if(state.collection.protocolVersion!==2 || state.collection.catalogStatus!=='confirmed')throw new DomainError('CATALOG_REQUIRED','Confirm the catalogue before checking basket options.',409);
  const context=agentContextDigest(state.collection,state.participants);
  const active=state.participants.filter(p=>p.active);
  if(active.some(p=>!p.preferences?.basketOptions?.length))throw new DomainError('OPTIONS_REQUIRED','Each active buyer needs a confirmed whole basket first.',409);
  const initial=solveWholeBaskets(state.collection,state.participants);
  if(Array.isArray(initial))return {complete:true,context,toolCalls:[{name:'check_plan',summary:'A complete accepted plan already exists.'}]};
  const hints:{buyerId:BuyerId;itemIds:string[]}[]=[];
  for(const buyer of active.filter(p=>(p.preferences?.basketOptions?.length??2)<2)){
    const other=active.filter(p=>p.id!==buyer.id);let combinations:string[][]=[[]];
    for(const p of other)combinations=combinations.flatMap(ids=>(p.preferences?.basketOptions??[]).filter(o=>o.itemIds.every(id=>!ids.includes(id))).map(o=>[...ids,...o.itemIds]));
    for(const taken of combinations){const rest=state.collection.items.filter(i=>!taken.includes(i.id)).map(i=>i.id);
      if(rest.length&&engine.checkCandidate(buyer.id,rest).feasible&&!hints.some(h=>h.buyerId===buyer.id&&h.itemIds.join(',')===rest.join(',')))hints.push({buyerId:buyer.id,itemIds:rest});}
  }
  const calls:CheckedQuestion['toolCalls']=[];const history:{role:string;content:string}[]=[{role:'user',content:'Find one human question that could unlock this lot. Start by reading the tools. You have at most eight actions.'}];
  const done=new Set<string>();let checked:string|undefined;let compared:string|undefined;let trace:AiTrace|undefined;
  const key=(id:string|null,ids:string[])=>`${id}:${[...ids].sort().join(',')}`;
  for(let step=0;step<8;step++){
    if(agentContextDigest(engine.snapshot().collection,engine.snapshot().participants)!==context)throw new DomainError('STALE_CONTEXT','The conditions changed. Check them again.',409);
    let action:{action:string;buyerId:string|null;itemIds:string[]};
    if(provider?.agentStep){
      const allowed=!done.has('read_catalog')?['read_catalog']:!done.has('read_conditions')?['read_conditions']:!done.has('check_plan')?['check_plan']:!checked?['check_candidate','stop']:!compared?['compare_plan','check_candidate','stop']:['propose_question','check_candidate','stop'];
      const response=await provider.agentStep(history,allowed);trace=response.trace;action=response;
    }
    else if(engine.options.mode==='rehearsal'){
      const candidate=hints.find(h=>h.buyerId==='ola')??hints[0];
      action={action:['read_catalog','read_conditions','check_plan','check_candidate','compare_plan','propose_question'][step]??'stop',buyerId:candidate?.buyerId??null,itemIds:candidate?.itemIds??[]};
    }else throw new DomainError('AI_NOT_CONFIGURED','The AI assistant is not configured. Saved basket options have not changed.',503);
    history.push({role:'assistant',content:JSON.stringify({action:action.action,buyerId:action.buyerId,itemIds:action.itemIds})});
    let output:unknown;let summary:string;
    switch(action.action){
      case 'read_catalog':output=state.collection.items.map(({id,name,description,shareCents})=>({id,name,description,priceCents:shareCents}));summary=`Read ${state.collection.items.length} confirmed items and fixed prices.`;break;
      case 'read_conditions':output={buyers:active.map(p=>({id:p.id,name:p.name,description:p.preferences?.description,confirmedOptions:p.preferences?.basketOptions,privateLimitCents:p.preferences?.budgetCents})),candidateHints:hints};summary='Read complete confirmed options and private limits without publishing them.';break;
      case 'check_plan':output=initial;summary='Checked every saved whole-basket combination; no full allocation exists.';break;
      case 'check_candidate':{
        if(!['read_catalog','read_conditions','check_plan'].every(n=>done.has(n)))throw new DomainError('AGENT_ORDER','The assistant did not read the required facts. No options changed.',502);
        if(!active.some(p=>p.id===action.buyerId))throw new DomainError('AGENT_BUYER','The assistant proposed an unknown buyer.',502);
        output=engine.checkCandidate(action.buyerId as BuyerId,action.itemIds);checked=(output as {feasible:boolean}).feasible?key(action.buyerId,action.itemIds):undefined;
        summary=(output as {feasible:boolean}).feasible?'A complete hypothetical split fits the confirmed options and limits. Human acceptance is still required.':'The candidate does not unlock a full accepted split.';break;
      }
      case 'compare_plan':{
        if(!checked||checked!==key(action.buyerId,action.itemIds))throw new DomainError('AGENT_UNCHECKED','The assistant did not check this exact candidate.',502);
        output={buyerId:action.buyerId,proposedWholeBasket:action.itemIds,amountCents:engine.checkCandidate(action.buyerId as BuyerId,action.itemIds).amountCents,otherBuyersUseOnlyConfirmedOptions:true,accepted:false};
        compared=checked;summary='Compared the exact proposal. No buyer agreement or payment has changed.';break;
      }
      case 'propose_question':{
        if(!checked||compared!==checked||key(action.buyerId,action.itemIds)!==checked)throw new DomainError('AGENT_UNCHECKED','The assistant did not verify and compare this exact question.',502);
        const candidate=engine.checkCandidate(action.buyerId as BuyerId,action.itemIds);if(!candidate.feasible)throw new DomainError('STALE_CONTEXT','The proposal is no longer feasible.',409);
        const buyer=active.find(p=>p.id===action.buyerId)!;
        const names=action.itemIds.map(id=>state.collection.items.find(i=>i.id===id)!.name);
        return {complete:false,context,trace,toolCalls:calls,question:{buyerId:buyer.id,buyerName:buyer.name,itemIds:[...action.itemIds].sort(),amountCents:candidate.amountCents,
          question:`Would ${names.length===2?names.join(' and '):names.join(', ')} work for you instead?`,
          reason:'This exact option could complete the lot using the other buyers’ confirmed baskets. You can keep your original choice.',
          checked:true as const,source:trace?'nebius' as const:'rehearsal' as const,model:trace?.model,toolCalls:calls}};
      }
      case 'stop':throw new DomainError('NO_CHECKED_QUESTION','The assistant found no checked question to suggest. Review the confirmed options.',409);
      default:throw new DomainError('AGENT_TOOL','The assistant requested an unavailable tool. No data changed.',502);
    }
    done.add(action.action);calls.push({name:action.action,summary});history.push({role:'user',content:JSON.stringify({tool:action.action,result:output})});
  }
  throw new DomainError('AGENT_LIMIT','The assistant reached its bounded tool limit. No buyer options changed.',409);
}
