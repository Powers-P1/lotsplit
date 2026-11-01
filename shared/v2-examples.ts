import type { DemoCollectionId } from './demo-collections.js';

export const V2_EXAMPLES: { id: DemoCollectionId; name: string; itemCount: number; buyerCount: number; imageUrl: string }[] = [
  { id: 'office', name: 'Office clearance', itemCount: 15, buyerCount: 4, imageUrl: '/assets/v2/office.png' },
  { id: 'home', name: 'Garage sale', itemCount: 9, buyerCount: 3, imageUrl: '/assets/v2/garage.png' },
  { id: 'cafe', name: 'Café closure', itemCount: 18, buyerCount: 5, imageUrl: '/assets/v2/cafe.png' },
  { id: 'workshop', name: 'Workshop clearance', itemCount: 12, buyerCount: 4, imageUrl: '/assets/v2/hero.png' },
];
