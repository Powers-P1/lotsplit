import type { AppMode, BuyerId, Collection, DemoAccess, Participant, UserId } from '../shared/types.js';
import { DEMO_COLLECTIONS, getDemoCollectionPricing, type DemoCollectionId } from '../shared/demo-collections.js';

export const DEMO_ACCESS: DemoAccess[] = [
  { name: 'Kasia', role: 'organizer', inviteToken: 'demo-kasia' },
  ...(['maja', 'ola', 'bartek', 'jan', 'ewa'] as BuyerId[]).map(id => ({
    name: id[0].toUpperCase() + id.slice(1), role: 'buyer' as const, inviteToken: `demo-${id}`,
  })),
];
export const DEMO_DEFAULTS: Record<BuyerId, { preferredItemIds: string[]; alternativeItemIds: string[]; budgetCents: number }> = {
  maja: { preferredItemIds: ['01', '04', '07', '09', '12', '18'], alternativeItemIds: ['20'], budgetCents: 20000 },
  ola: { preferredItemIds: ['02', '03', '05', '06', '08', '10'], alternativeItemIds: [], budgetCents: 23000 },
  bartek: { preferredItemIds: ['11', '13', '14', '15', '16', '17'], alternativeItemIds: [], budgetCents: 25000 },
  jan: { preferredItemIds: ['19', '20', '21', '22', '23', '24'], alternativeItemIds: [], budgetCents: 26000 },
  ewa: { preferredItemIds: ['18', '19', '21', '22', '23', '24'], alternativeItemIds: [], budgetCents: 26000 },
};
const demoBudgets: Partial<Record<DemoCollectionId, Record<BuyerId, number>>> = {
  workshop: { maja: 65000, ola: 33000, bartek: 36000, jan: 43000, ewa: 43000 },
  home: { maja: 95000, ola: 70000, bartek: 85000, jan: 70000, ewa: 70000 },
  office: { maja: 220000, ola: 150000, bartek: 100000, jan: 100000, ewa: 100000 },
};
/** Retain the historical preferences while applying each example's own, explicit limits. */
export function getDemoDefaults(collectionId: DemoCollectionId | undefined, buyerId: BuyerId) {
  const defaults = DEMO_DEFAULTS[buyerId];
  return { preferredItemIds: [...defaults.preferredItemIds], alternativeItemIds: [...defaults.alternativeItemIds],
    budgetCents: collectionId ? demoBudgets[collectionId]?.[buyerId] ?? defaults.budgetCents : defaults.budgetCents };
}
export const USER_NAMES: Record<UserId, string> = { kasia: 'Kasia', maja: 'Maja', ola: 'Ola', bartek: 'Bartek', jan: 'Jan', ewa: 'Ewa' };
export function userForId(id: UserId) {
  return { id, name: USER_NAMES[id], email: `${id}@lotsplit.example`, role: id === 'kasia' ? 'organizer' as const : 'buyer' as const };
}
const names = [
  'Portrait', 'Moth', 'Sun', 'Moon', 'Hare', 'Wolf', 'Deer', 'Bear', 'Raven', 'Butterfly', 'Lynx', 'Snake',
  'Tree', 'Mushrooms', 'Lake', 'Dragonfly', 'Falcon', 'Night', 'Crane', 'Owl', 'Fox', 'Mountains', 'Rose', 'Compass',
];
const workshopItems = [
  ['Hammer drill', 'Corded drill with a hammer setting and side handle. For drilling into wood and masonry.', 'Dobry — rysy na obudowie, uchwyt kompletny'],
  ['Claw hammer', 'Hammer with a wooden handle and claw for pulling nails.', 'Używany — ślady na obuchu, stabilny trzonek'],
  ['Combination pliers', 'Multipurpose pliers for gripping, bending, and cutting thin wire.', 'Dobry — powierzchowne ślady na szczękach'],
  ['Cordless screwdriver', 'Screwdriver with one battery, a charger, and adjustable torque.', 'Dobry — ślady chwytu, akumulator i ładowarka w komplecie'],
  ['Open-ended spanner set', 'Spanners in several sizes, stored in a fabric case.', 'Używany — otarcia na kluczach, etui bez rozdarć'],
  ['Socket set', 'Ratchet, sockets, and a short extension in a closing case.', 'Dobry — ślady pracy, zatrzaski walizki całe'],
  ['Angle grinder', 'Compact corded grinder with a guard and extra handle. No cutting disc included.', 'Używana — otarcia obudowy, osłona i rękojeść kompletne'],
  ['Screwdriver set', 'Flat-head and cross-head screwdrivers in several sizes.', 'Dobry — drobne ślady na końcówkach'],
  ['Drill bit set', 'Wood and metal drill bits in a plastic box.', 'Używane — część wierteł ma ślady ostrzenia'],
  ['Bench vice', 'Metal vice with a worktop mount and swivel base.', 'Używane — ubytki lakieru, szczęki bez pęknięć'],
  ['Woodworking clamp', 'Screw clamp for holding parts during gluing and assembly.', 'Dobry — ślady kleju na jednej podkładce'],
  ['Hand saw', 'Wood saw with a closed handle and a blade guard.', 'Używana — rysy na brzeszczocie, rękojeść cała'],
  ['Soldering iron', 'Soldering iron with a stand and power cord. No extra tips included.', 'Dobry — przyciemniony grot, podstawka w komplecie'],
  ['Multimeter', 'Digital meter with two test leads and a case.', 'Dobry — lekkie rysy na osłonie wyświetlacza'],
  ['Laser level', 'Level for horizontal and vertical alignment, with a small base. No tripod included.', 'Bardzo dobry — niewielkie ślady na podstawce'],
  ['Wire stripper', 'Hand tool for stripping insulation from wires of different sizes.', 'Dobry — otarcia rękojeści'],
  ['Vernier caliper', 'Metal caliper in a box, with a millimetre scale and depth gauge.', 'Dobry — drobne rysy, czytelna podziałka'],
  ['Tool bag', 'Fabric bag with handles and pockets for small tools. Sold empty.', 'Używana — przybrudzone dno, sprawny zamek'],
  ['Heat gun', 'Corded heat gun with two airflow settings and one standard nozzle.', 'Dobry — ślady nagrzewania na metalowej dyszy'],
  ['Jigsaw', 'Corded jigsaw with an adjustable base and one wood-cutting blade.', 'Używana — rysy na stopie, uchwyt bez uszkodzeń'],
  ['Orbital sander', 'Sander for flat surfaces, with a rectangular base and dust bag.', 'Używana — pył w zakamarkach, worek bez rozdarć'],
  ['Work light', 'Portable work light with a stand handle and power cord.', 'Dobry — otarcia stelaża, klosz cały'],
  ['Toolbox', 'Rigid toolbox with a removable tray and two catches. Sold empty.', 'Dobry — rysy na pokrywie, kompletne zawiasy'],
  ['Cable reel', 'Extension cable on a winding reel, with a handle and several sockets.', 'Używany — otarcia bębna, przewód bez widocznych przecięć'],
] as const;
const homeItems = [
  ['City bicycle', 'Used bicycle with a low frame, mudguards, and a rear rack. No extra lock included.', 'Dobry — otarcia lakieru, widoczne ślady na siodełku'],
  ['Floor lamp', 'Standing lamp with a metal base, lampshade, and switch on the cord.', 'Dobry — drobne rysy podstawy, abażur cały'],
  ['Acoustic guitar', 'Six-string acoustic guitar with a simple fabric case.', 'Używana — rysy na płycie wierzchniej, pokrowiec bez rozdarć'],
  ['Cordless drill', 'Compact drill with one battery, a charger, and a bit holder.', 'Dobry — ślady chwytu na obudowie, ładowarka w komplecie'],
  ['Wall mirror', 'Mirror in a simple wooden frame, with hanging brackets.', 'Bardzo dobry — drobne otarcie dolnej krawędzi ramy'],
  ['Side table', 'Small table for placing beside a sofa or armchair.', 'Używany — pojedyncza rysa na blacie'],
  ['Camping tent', 'Tent with a flysheet, poles, and carry bag for short camping trips.', 'Używany — zabrudzenie pokrowca, śledzie i stelaż w komplecie'],
  ['Book set', 'A small selection from a home library, treated as one item in this split.', 'Używane — drobne zagięcia i otarcia okładek'],
  ['Desk chair', 'Swivel chair with adjustable height and armrests.', 'Używane — zmechacenie tapicerki, komplet kółek'],
  ['Retro games console', 'Compact games console with two controllers, a video cable, and a power supply.', 'Używana — lekkie przebarwienie obudowy, dwa pady w komplecie'],
  ['Toolbox', 'Plastic toolbox with a removable tray and two catches. Sold empty.', 'Używana — rysy na pokrywie, zatrzaski całe'],
  ['Bedside table', 'Small cabinet with a drawer and an open shelf.', 'Dobry — lekki ślad po kubku na górnym blacie'],
  ['Keyboard', 'Electronic keyboard with a power supply and music rest. No stand included.', 'Dobry — drobne ślady na klawiszach, podpórka cała'],
  ['Potted monstera', 'Rooted houseplant with a support and ceramic outer pot.', 'Dobry — jeden starszy liść z zaschniętym brzegiem'],
  ['Electric kettle', 'Cordless kettle with a power base and lid.', 'Używany — niewielki osad wewnątrz, podstawa w komplecie'],
  ['Vacuum cleaner', 'Corded vacuum cleaner with a tube, hose, and standard floor brush.', 'Dobry — rysy obudowy, komplet głównych akcesoriów'],
  ['Camera', 'Compact camera with a strap, battery, and charger. No extra memory card included.', 'Dobry — rysy na osłonie wyświetlacza, obiektyw bez widocznych pęknięć'],
  ['Rug', 'Rectangular, low-pile rug for a living room or bedroom.', 'Używany — lekko spłaszczone runo w jednym miejscu'],
  ['Toaster', 'Compact two-slice toaster with a removable crumb tray.', 'Dobry — drobne rysy na obudowie'],
  ['Table lamp', 'Small lamp with a lampshade and switch on the cord.', 'Dobry — lekkie otarcie podstawy'],
  ['Dumbbell pair', 'Two matching dumbbells for home exercise, treated as one item.', 'Używane — otarcia powłoki przy końcach'],
  ['Tennis racket pair', 'Two tennis rackets with cases, treated as one item in this split.', 'Używane — wytarte owijki, naciągi bez widocznych zerwań'],
  ['Microwave', 'Freestanding microwave with a turntable and control knobs.', 'Dobry — rysa na boku, talerz bez uszkodzeń'],
  ['Saucepan set', 'Saucepans in different sizes with matching lids.', 'Używane — ślady na dnach, uchwyty i pokrywki kompletne'],
] as const;
const officeItems = [
  ['Office laptop', 'Used laptop for office work, with a power supply. Part of a fictional small business inventory.', 'Dobry — otarcia pokrywy i wytarte klawisze, zasilacz w komplecie'],
  ['24-inch monitor', 'Desktop monitor with a stand, power cable, and video cable.', 'Dobry — drobne rysy na podstawie, komplet przewodów'],
  ['Office chair', 'Swivel chair with adjustable height and armrests.', 'Używany — przetarta tapicerka podłokietników, komplet kółek'],
  ['Desktop computer', 'Office computer in a tower case, with a power cable. No monitor or keyboard included.', 'Dobry — rysy na boku obudowy, kompletna osłona'],
  ['Laser printer', 'Office document printer with a paper tray and power cable.', 'Używana — otarcia obudowy, toner o nieustalonym zużyciu'],
  ['Document scanner', 'Scanner for digitising documents, with a connection cable and power supply.', 'Dobry — drobne ślady na pokrywie, szyba bez widocznych pęknięć'],
  ['Projector', 'Presentation projector with a power supply and carry bag. No projection screen included.', 'Używany — otarcia obudowy, czas pracy lampy nieustalony'],
  ['Meeting table', 'Table from a meeting room, with a tabletop and a complete set of legs.', 'Dobry — rysy przy jednej krawędzi blatu'],
  ['Under-desk pedestal', 'Small drawer cabinet on castors for placing under a desk.', 'Używany — otarcia frontów, bez kluczyka do zamka'],
  ['Desk', 'Simple work desk with a cable opening and metal frame.', 'Dobry — ślady po ramieniu monitora na krawędzi'],
  ['Router', 'Office router with a power supply and short network cable.', 'Dobry — lekkie przebarwienie obudowy, zasilacz w komplecie'],
  ['Network switch', 'Small switch for distributing a wired network between workstations.', 'Dobry — rysy na spodzie, przewód zasilający w komplecie'],
  ['Monitor arm', 'Arm for mounting one monitor to a desk edge, with a clamp and bracket.', 'Używane — otarcia zacisku, komplet głównych elementów'],
  ['Label printer', 'Compact label printer with a power supply. No spare label rolls included.', 'Dobry — ślady na pokrywie, zasilacz w komplecie'],
  ['Paper shredder', 'Document shredder with a removable waste bin.', 'Używana — drobne rysy kosza, pokrywa bez pęknięć'],
  ['Coffee machine', 'Coffee machine from an office kitchenette, with a removable water tank and drip tray.', 'Używany — ślady kamienia na tacce, zbiornik cały'],
  ['Mini fridge', 'Freestanding under-counter fridge with shelves, from an office kitchenette.', 'Dobry — wgniecenie na boku, komplet półek'],
  ['Office shelving', 'Shelving unit with adjustable shelves for binders and office supplies.', 'Używany — otarcia półek, komplet podpórek'],
  ['Desk lamp', 'Workstation lamp with an adjustable arm and base.', 'Dobry — rysy podstawy, przewód bez widocznych uszkodzeń'],
  ['Whiteboard', 'Board with a marker tray and hanging brackets. No markers or wall plugs included.', 'Używana — delikatne ślady po pisakach i rysa na ramie'],
  ['Meeting chair set', 'Chairs from one meeting room, treated as one item in this split.', 'Używane — otarcia nóg i niewielkie przetarcia siedzisk'],
  ['Storage container set', 'Plastic containers for storing supplies and small equipment.', 'Używane — pozostałości etykiet, pojemniki bez pęknięć'],
  ['UPS battery backup', 'Backup power supply for a workstation, with a power cable.', 'Używany — rysy na obudowie, zużycie akumulatora nieustalone'],
  ['Conference camera', 'Camera for remote meetings, with a mount and connection cable.', 'Dobry — otarcie uchwytu, osłona obiektywu bez widocznych rys'],
] as const;
const vinylItems = [
  ['Quiet Morning', 'A jazz trio for a calm start to the day. Cream sleeve with yellow geometric shapes.'],
  ['Golden City', 'Warm soul with vocals and brass. Orange sleeve with a sun.'],
  ['On the Dance Floor', 'Danceable disco with a strong bass line. Pink sleeve with a grid pattern.'],
  ['Rain on the Window', 'Intimate piano jazz. Blue sleeve with rain streaks.'],
  ['Summer Rhythm', 'Energetic funk for summer evenings. Green and yellow sleeve.'],
  ['Beyond the Night', 'Night-time disco with synthesisers. Purple sleeve with a moon.'],
  ['Wooden Bridge', 'Acoustic songs with guitar. Sleeve showing a bridge in a forest.'],
  ['Street Lights', 'Melodic dance-pop with an urban rhythm. Turquoise sleeve with a city skyline.'],
  ['Small Hours', 'Atmospheric jazz with double bass and saxophone. Minimal burgundy sleeve.'],
  ['Voice and Heart', 'Vocal soul and soulful ballads. Red sleeve with a singer silhouette.'],
  ['Garage Stories', 'Raw garage rock with a guitar-driven sound. Black and ochre sleeve.'],
  ['Between the Words', 'Personal folk with acoustic instruments. Beige sleeve with leaves.'],
  ['Long Horizon', 'Classic rock with a road-trip mood. Sleeve showing a road through the desert.'],
  ['Heavy Clouds', 'Progressive rock with longer compositions. Dark sleeve with a stormy sky.'],
  ['Last Train', 'Travel-inspired guitar blues. Navy sleeve with an old train.'],
  ['Concrete Garden', 'Alternative rock with urban lyrics. Grey sleeve with architecture.'],
  ['Signal from Space', 'Spacious space rock with synthesisers. Navy and orange sleeve with a planet.'],
  ['Stillness by the Water', 'Gentle ambient with folk guitar. Sleeve showing a lake at dusk.'],
  ['Orbits', 'Electronic music with pulsing sequences. Purple sleeve with concentric circles.'],
  ['Night Tram', 'Calm downtempo for a night journey. Sleeve with golden rails in a dark city.'],
  ['Hidden Frequencies', 'Minimal techno with a deep pulse. Black sleeve with a cyan pattern.'],
  ['Ocean of Signals', 'Ambient with long, flowing sounds. Blue sleeve with a wave motif.'],
  ['Tape 1986', 'Synthwave inspired by analogue synthesisers. Salmon sleeve with a perspective grid.'],
  ['Tomorrow Starts Today', 'Light, melodic electronic music. White sleeve with a colourful prism.'],
] as const;
const bookItems = [
  ['Forest Plant Atlas', 'Illustrated guide to plants found in Polish forests. Green cover with a herbarium motif.'],
  ['The House by the Bay', 'A novel about returning to the family home. Blue cover with a house by the water.'],
  ['Letters from Afar', 'A novel about friendship sustained through letters. Cream cover with envelopes.'],
  ['Travel Sketchbook', 'A collection of sketches and tips for drawing while travelling. Terracotta cover with drawings.'],
  ['Last Summer in the City', 'A novel about neighbours in one apartment building. Yellow cover with city buildings.'],
  ['The Old Bookshop Secret', 'A novel with a mystery hidden among books. Burgundy cover with a golden door.'],
  ['Birds of Our Gardens', 'An illustrated birdwatching guide. Sage cover with a bird on a branch.'],
  ['Where the Road Ends', 'A road novel about changing everyday life. Turquoise cover with a distant horizon.'],
  ['Small Landscapes', 'A collection of photographs and painted landscape studies. Muted pink cover.'],
  ['Sunday at Dawn', 'An intimate novel about meeting again after many years. Lilac cover with a lit window.'],
  ['One-Pot Cooking', 'Practical recipes for simple meals. Orange cover with a cooking pot.'],
  ['Unhurried Photography', 'A guide to mindful photography of everyday life. Cover with a black-and-white tree photograph.'],
  ['Cycling Across Europe', 'A guide to cycling routes and preparing for a trip. Red cover with a bicycle.'],
  ['Along the Mountain Huts', 'A guide to mountain trails and accommodation. Dark green cover with mountains.'],
  ['Bread from the Home Oven', 'A guide to yeast and sourdough bread baking. Cream and brown cover with a loaf.'],
  ['Fix It Yourself', 'A guide to small household repairs. Navy cover with basic tools.'],
  ['A Map of Weekend Trips', 'Ideas for short trips and route planning. Ochre cover with a map drawing.'],
  ['The Forest After Dark', 'Illustrated nature stories about animals active after sunset. Navy cover with an owl.'],
  ['A Short History of Stars', 'An accessible introduction to the life of stars. Navy cover with a starry sky.'],
  ['How Everyday Things Work', 'Explanations of mechanisms hidden in ordinary objects. Light blue cover with gears.'],
  ['Stories from Old Cities', 'Popular history of urban customs and architecture. Sand-coloured cover with an old town.'],
  ['An Ocean of Secrets', 'A popular science journey into the deep sea. Turquoise cover with waves.'],
  ['Mathematics on a Walk', 'Accessible puzzles and mathematical patterns in our surroundings. Yellow cover with geometric paths.'],
  ['The Future Is Closer Than You Think', 'A popular science look at everyday technology. White cover with a geometric planet.'],
] as const;

/** Keep the historical default for callers creating a real Sandbox collection. */
export function createCollection(nowDate = new Date(), collectionId: DemoCollectionId = 'illustrations'): Collection {
  const example = DEMO_COLLECTIONS.find(collection => collection.id === collectionId)!;
  const contents: readonly (readonly [string, string, string?])[] | undefined = collectionId === 'office' ? officeItems : collectionId === 'workshop' ? workshopItems
    : collectionId === 'home' ? homeItems : collectionId === 'vinyl' ? vinylItems : collectionId === 'books' ? bookItems : undefined;
  const { itemSharesCents, ...pricing } = getDemoCollectionPricing(collectionId);
  return {
    id: collectionId === 'illustrations' ? 'kolekcja-kasi' : `kolekcja-${collectionId}`,
    name: collectionId === 'illustrations' ? 'Kasia’s Collection' : example.name,
    description: collectionId === 'illustrations' ? 'One collection, 24 items. Agree on a complete split together.' : example.description,
    currency: 'PLN', ...pricing,
    buyerCount: 4, itemsPerBuyer: 6, reservationExpiresAt: new Date(nowDate.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    catalogStatus: 'draft', preferencesOpened: false, catalogVersion: 1, photos: [example.imageUrl],
    items: itemSharesCents.map((shareCents, index) => {
      const id = String(index + 1).padStart(2, '0');
      return { id, name: contents?.[index][0] ?? names[index],
        description: contents?.[index][1] ?? `Collectible card #${id}. An item from Kasia’s collection.`,
        condition: contents?.[index][2] ?? (collectionId === 'vinyl' ? 'Dobry — drobne ślady na okładce' : collectionId === 'books' ? 'Dobry — niewielkie ślady czytania' : 'Bardzo dobry'),
        imageUrl: collectionId === 'illustrations' ? `/assets/items/${id}.png` : `/assets/examples/${collectionId}/atlas.png#tile=${id}`, shareCents,
        confirmed: false, needsReview: false };
    }),
  };
}
export function createParticipants(): Participant[] {
  return (['maja', 'ola', 'bartek', 'jan', 'ewa'] as BuyerId[]).map(id => ({
    id, name: USER_NAMES[id], email: `${id}@lotsplit.example`, active: id !== 'ewa',
  }));
}
export function demoInvitationUser(token: string): UserId | undefined {
  const entry = DEMO_ACCESS.find(access => access.inviteToken === token);
  return entry ? token.slice(5) as UserId : undefined;
}
export function sourceForMode(mode: AppMode) { return mode === 'rehearsal' ? 'rehearsal' as const : 'paypal-sandbox' as const; }
