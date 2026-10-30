/** Public examples only: these summaries never describe a stored Sandbox collection. */
export type DemoCollectionId = 'home' | 'office' | 'workshop' | 'vinyl' | 'books' | 'illustrations';

export interface DemoCollectionSummary {
  id: DemoCollectionId;
  name: string;
  description: string;
  imageUrl: string;
  itemCount: number;
  buyerCount: number;
  itemsPerBuyer: number;
  collectionPriceCents: number;
  sharedCostCents: number;
  totalCents: number;
}

export const DEFAULT_DEMO_COLLECTION_ID: DemoCollectionId = 'home';

const historicalShares = [25, 30, 30, 25, 30, 30, 30, 30, 25, 30, 30, 25, 30, 30, 30, 30, 40, 20, 30, 30, 30, 30, 40, 40];
const demoPricing: Record<DemoCollectionId, { shares: readonly number[]; sharedCost: number }> = {
  workshop: { shares: [180, 25, 35, 160, 40, 50, 130, 30, 35, 60, 25, 35, 45, 55, 70, 30, 45, 30, 35, 40, 55, 75, 90, 45], sharedCost: 160 },
  home: { shares: [250, 80, 120, 180, 90, 60, 110, 70, 75, 130, 100, 80, 120, 90, 60, 140, 180, 100, 85, 95, 60, 65, 125, 115], sharedCost: 240 },
  office: { shares: [600, 220, 150, 500, 200, 180, 350, 240, 90, 160, 80, 90, 70, 110, 100, 180, 160, 120, 50, 80, 160, 80, 180, 170], sharedCost: 480 },
  vinyl: { shares: historicalShares, sharedCost: 120 },
  books: { shares: historicalShares, sharedCost: 120 },
  illustrations: { shares: historicalShares, sharedCost: 120 },
};

/** One pricing source for the public demo cards and the seeded catalogs. All returned amounts are grosz. */
export function getDemoCollectionPricing(collectionId: DemoCollectionId) {
  const pricing = demoPricing[collectionId];
  const itemSharesCents = pricing.shares.map(share => share * 100);
  const collectionPriceCents = itemSharesCents.reduce((sum, share) => sum + share, 0);
  const sharedCostCents = pricing.sharedCost * 100;
  return { itemSharesCents, collectionPriceCents, sharedCostCents, totalCents: collectionPriceCents + sharedCostCents };
}

function summaryPricing(collectionId: DemoCollectionId) {
  const { itemSharesCents: _shares, ...totals } = getDemoCollectionPricing(collectionId);
  return totals;
}

export const DEMO_COLLECTIONS: readonly DemoCollectionSummary[] = [
  {
    id: 'home', name: 'Garage Sale',
    description: 'A seller offers one mixed lot: a bicycle, instruments, electronics, and household items. Different buyers want different parts.',
    imageUrl: '/assets/examples/home/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('home'),
  },
  {
    id: 'office', name: 'Small Business Clearance',
    description: 'An entire office inventory sold as one lot before the lease ends. Buyers furnishing home offices, startups, and coworking spaces choose different parts.',
    imageUrl: '/assets/examples/office/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('office'),
  },
  {
    id: 'workshop', name: 'Workshop Equipment',
    description: 'Power tools, hand tools, and accessories. Split 24 used workshop items.',
    imageUrl: '/assets/examples/workshop/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('workshop'),
  },
  {
    id: 'vinyl', name: 'Second-Hand Vinyl',
    description: 'Jazz, soul, rock, and electronic music. Split 24 used records to suit your tastes.',
    imageUrl: '/assets/examples/vinyl/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('vinyl'),
  },
  {
    id: 'books', name: 'Moving-Day Bookshelf',
    description: 'Novels, art books, practical guides, and popular science. Find a new home for 24 books.',
    imageUrl: '/assets/examples/books/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('books'),
  },
  {
    id: 'illustrations', name: 'Collectible Illustrations',
    description: 'The original example: 24 illustrated cards from Kasia’s collection.',
    imageUrl: '/assets/collection.png',
    itemCount: 24, buyerCount: 4, itemsPerBuyer: 6, ...summaryPricing('illustrations'),
  },
];

export function isDemoCollectionId(value: unknown): value is DemoCollectionId {
  return typeof value === 'string' && DEMO_COLLECTIONS.some(collection => collection.id === value);
}
