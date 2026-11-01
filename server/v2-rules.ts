import { createHash } from 'node:crypto';
import type { Assignment, Collection, NoSolution, Participant } from '../shared/types.js';

export const V2_CONTRACT = 'own-basket-group-v2' as const;
export function wholeBasketDigest(collection: Collection, buyerId: string, itemIds: string[], totalCents: number) {
  return createHash('sha256').update(JSON.stringify({ contract: V2_CONTRACT,
    collectionId: collection.id, recipient: collection.seller, buyerId, currency: collection.currency,
    items: [...itemIds].sort().map(id => collection.items.find(i => i.id === id)), totalCents,
    wholeLotCents: collection.totalCents, wholeLotItemIds: collection.items.map(i=>i.id).sort(),
    deadline: collection.reservationExpiresAt, pickup: collection.pickup,
    otherBuyersAndTheirBasketsMayChange: true,
  })).digest('hex');
}

/** At most 2^6 complete combinations. There is no item-by-item mixing of options. */
export function solveWholeBaskets(collection: Collection, participants: Participant[], previous: Assignment[] = [], maxCombinations = 128): Assignment[] | NoSolution {
  const buyers = participants.filter(p=>p.active);
  const budgetTotal = buyers.reduce((sum,p)=>sum+(p.preferences?.budgetCents ?? 0),0);
  const no = (code: NoSolution['code'], message: string, ids = collection.items.map(i=>i.id)): NoSolution => ({ code, message,
    activeBuyerCount: buyers.length, requiredBuyerCount: Math.max(2,buyers.length), totalCents: collection.totalCents,
    limitsTotalCents: budgetTotal, shortfallCents: Math.max(0,collection.totalCents-budgetTotal), unassignedItemIds: ids });
  if (buyers.length < 2 || buyers.length > 6) return no('BUYER_COUNT','This lot needs two to six active buyers.');
  if (!collection.items.length || collection.items.length > 24) return no('NO_ALLOCATION','The catalogue must contain one to 24 distinct items.');
  if (buyers.some(p=>!p.preferences?.submittedAt || !p.preferences.basketOptions?.length))
    return no('MISSING_PREFERENCES','Waiting for a confirmed whole basket from each active buyer.');
  const prices = new Map(collection.items.map(i=>[i.id,i.shareCents]));
  const options = buyers.map(b=> (b.preferences!.basketOptions ?? []).slice(0,2).filter(o=> o.confirmedAt && o.itemIds.length &&
    new Set(o.itemIds).size === o.itemIds.length && o.itemIds.every(id=>prices.has(id)) &&
    !o.itemIds.some(id=>b.preferences?.rejectedItemIds?.includes(id)) && o.itemIds.reduce((sum,id)=>sum+prices.get(id)!,0) <= b.preferences!.budgetCents));
  const chosen: string[][] = []; let best: Assignment[] | undefined; let score = Infinity; let examined = 0; let incomplete = false;
  let mostCovered = new Set<string>();
  function search(depth: number, used: Set<string>) {
    if (used.size > mostCovered.size) mostCovered = new Set(used);
    if (depth === buyers.length) {
      if (++examined > maxCombinations) { incomplete=true; return; }
      if (used.size !== collection.items.length) return;
      const assignments = buyers.map((buyer,index)=> {
        const itemIds=[...chosen[index]].sort(); const baseCents=itemIds.reduce((sum,id)=>sum+prices.get(id)!,0);
        return { buyerId:buyer.id,itemIds,baseCents,sharedCostCents:0,totalCents:baseCents,alternativeItemIds:[],termsDigest:wholeBasketDigest(collection,buyer.id,itemIds,baseCents) };
      });
      const changes = assignments.reduce((sum,a)=>sum+Number(previous.some(p=>p.buyerId===a.buyerId && p.termsDigest!==a.termsDigest)),0);
      if (changes < score) { best=assignments; score=changes; }
      return;
    }
    for(const option of options[depth]) {
      if (option.itemIds.some(id=>used.has(id))) continue;
      chosen[depth]=option.itemIds;
      search(depth+1,new Set([...used,...option.itemIds]));
      if(incomplete) return;
    }
    // Only for explaining uncovered goods; never a complete solution without all buyers.
    if (!options[depth].length || options[depth].every(o=>o.itemIds.some(id=>used.has(id)))) {
      for(let i=depth+1;i<buyers.length;i++) {
        const option=options[i].find(o=>o.itemIds.every(id=>!used.has(id)));
        if(option) { for(const id of option.itemIds) used.add(id); }
      }
      if(used.size>mostCovered.size) mostCovered=new Set(used);
    }
  }
  if(maxCombinations<1) incomplete=true; else search(0,new Set());
  if(incomplete) return no('INCOMPLETE','The plan check did not finish. No complete plan has been confirmed.',[]);
  if(best) return best;
  return no('NO_ALLOCATION','The confirmed basket options do not cover the whole lot.',collection.items.filter(i=>!mostCovered.has(i.id)).map(i=>i.id));
}

export function agentContextDigest(collection: Collection, participants: Participant[]) {
  return createHash('sha256').update(JSON.stringify({ collection, participants: participants.map(p=>({id:p.id,active:p.active,preferences:p.preferences})) })).digest('hex');
}
