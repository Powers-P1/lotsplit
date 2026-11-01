import { randomUUID } from 'node:crypto';
import type { BuyerId, Collection, DemoAccess, Participant, SessionUser, UserId } from '../shared/types.js';
import type { DemoCollectionId } from '../shared/demo-collections.js';
import { V2_EXAMPLES } from '../shared/v2-examples.js';
import { createCollection } from './seed.js';

export const V2_BUYERS: BuyerId[] = ['maja', 'ola', 'bartek', 'jan', 'ewa', 'sixth'];
const names: Record<UserId, string> = { kasia: 'Alex', maja: 'Marta', ola: 'Jan', bartek: 'Lena', jan: 'Oskar', ewa: 'Nina', sixth: 'Sam' };
export const V2_ACCESS: DemoAccess[] = [{ name: 'Alex', role: 'organizer', inviteToken: 'demo-kasia' },
  ...V2_BUYERS.map(id => ({ name: names[id], role: 'buyer' as const, inviteToken: `demo-${id}` }))];
export function v2User(id: UserId, participants: Participant[]): SessionUser {
  const buyer = participants.find(p => p.id === id);
  return { id, name: buyer?.name ?? names[id], email: buyer?.email ?? 'alex@lotsplit.example', role: id === 'kasia' ? 'organizer' : 'buyer' };
}
export function v2Participants(count = 4): Participant[] {
  return V2_BUYERS.map((id, index) => ({ id, name: names[id], email: `${names[id].toLowerCase()}@lotsplit.example`, active: index < count }));
}
const workshop: [string, number, string][] = [
  ['Cordless drill', 220, 'Bare cordless drill. Battery and charger are separate items. Seller must verify compatibility.'],
  ['Battery', 100, 'One separate rechargeable tool battery. Seller must verify compatibility with the drill and charger.'],
  ['Charger', 60, 'One separate battery charger with power lead. Seller must verify compatibility.'],
  ['Corded drill', 140, 'Mains-powered drill with cable and side handle.'],
  ['Workbench', 360, 'Wooden top, black steel legs. One complete workbench.'],
  ['Task lamp', 80, 'Black adjustable task lamp with base.'],
  ['Storage cabinet', 240, 'Grey two-door steel storage cabinet.'],
  ['Office chair', 160, 'Grey fabric office chair on a caster base.'],
  ['Tool case', 90, 'One empty black carrying case.'],
  ['Box of clamps', 120, 'One box of assorted clamps; sold as one catalogue position.'],
  ['Hand tools', 180, 'One set of assorted hand tools; sold as one catalogue position.'],
  ['Extension reel', 50, 'Orange and black mains extension cable reel.'],
];
const cafe: [string, number][] = [
  ['Espresso machine', 1800], ['Coffee grinder', 500], ['Cups and saucers', 90], ['Milk pitchers', 60],
  ['Cafe table', 150], ['Two stools', 140], ['Display shelf', 120], ['Countertop blender', 100],
  ['Kettle', 90], ['Serving trays', 80], ['Glassware', 75], ['Storage jars', 65],
  ['Menu stand', 60], ['Waste bin', 55], ['Cleaning kit', 50], ['Cutlery set', 45], ['Wall clock', 40], ['Apron set', 30],
];
export function createV2Collection(now: Date, collectionId: DemoCollectionId = 'workshop', recipientId = 'configured-sandbox-merchant'): Collection {
  const example = V2_EXAMPLES.find(x => x.id === collectionId) ?? V2_EXAMPLES[3];
  const deadline = new Date(now.getTime() + 48 * 3600_000);
  deadline.setUTCHours(17,0,0,0);
  const pickup = new Date(deadline.getTime() + 24 * 3600_000);
  pickup.setUTCHours(9,0,0,0);
  const common = { protocolVersion: 2 as const, seller: { name: 'Alex', recipientId },
    pickup: { location: 'Warsaw, Praga', startsAt: pickup.toISOString(), endsAt: new Date(pickup.getTime() + 2 * 3600_000).toISOString() },
    id: `lot-${randomUUID()}`, name: example.name, description: 'One whole mixed lot. Agree who takes what, then arrange one pickup.',
    currency: 'PLN' as const, sharedCostCents: 0, buyerCount: example.buyerCount, itemsPerBuyer: 0,
    reservationExpiresAt: deadline.toISOString(), catalogStatus: 'draft' as const, preferencesOpened: false, catalogVersion: 1, photos: [example.imageUrl] };
  const items = collectionId === 'workshop' || !['home', 'office', 'cafe'].includes(collectionId)
    ? workshop.map(([name, price, description], index) => ({ id: String(index + 1).padStart(2, '0'), name, description,
      condition: 'Used — seller inspection required', imageUrl: `/assets/v2/items-${index < 4 ? '01-04' : index < 8 ? '05-08' : '09-12'}.png#cell=${index % 4}`,
      shareCents: price * 100, confirmed: false, needsReview: false }))
    : collectionId === 'cafe' ? cafe.map(([name, price], index) => ({ id: String(index + 1).padStart(2, '0'), name,
      description: `${name}. One catalogue position from the cafe closure lot.`, condition: 'Used — seller inspection required',
      imageUrl: example.imageUrl, shareCents: price * 100, confirmed: false, needsReview: false }))
    : createCollection(now, collectionId).items.slice(0, example.itemCount).map(item => ({ ...item, condition: 'Used — seller inspection required' }));
  const total = items.reduce((sum, item) => sum + item.shareCents, 0);
  return { ...common, items, totalCents: total, collectionPriceCents: total };
}
export function v2Defaults(collection: Collection, buyerId: BuyerId) {
  if (collection.name === 'Workshop clearance' && collection.items.length === 12) {
    const value: Record<BuyerId, [string[], number]> = { maja: [['01','02','03'],45000], ola: [['01','02','03'],50000],
      bartek: [['05','06','08','10'],85000], jan: [['07','09','11'],60000], ewa: [['05','10'],60000], sixth: [[],100000] };
    return { preferredItemIds: value[buyerId][0], alternativeItemIds: [], budgetCents: value[buyerId][1],description:buyerId==='maja'?'The cordless set is my only workable choice. I need a battery-powered drill away from sockets; a mains drill would not work.':buyerId==='ola'?'I need a drill for basic repairs near a power socket and could consider a mains-powered option.':'' };
  }
  const index = V2_BUYERS.indexOf(buyerId);
  const sizes = collection.items.length === 15 ? [4,4,3,4] : collection.items.length === 9 ? [2,3,4] : [4,3,4,3,4];
  const start = sizes.slice(0, index).reduce((sum,n) => sum+n,0);
  const items = collection.items.slice(start, start + (sizes[index] ?? 0));
  return { preferredItemIds: items.map(i=>i.id), alternativeItemIds: [], budgetCents: Math.max(10000, Math.ceil(items.reduce((sum,i)=>sum+i.shareCents,0)*1.2/100)*100),description:'' };
}
