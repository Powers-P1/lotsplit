import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Check, ChevronRight, Clock3, Info, Loader2, Minus } from 'lucide-react';
import type { ActionGate, OperationStatus, PublicItem } from '../shared/types';

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const money = (cents: number) => currency.format(cents / 100);
export const itemLabel = (count: number) => count === 1 ? 'item' : 'items';
export const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

const legacyConditions: Record<string, string> = {
  'Dobry': 'Good', 'Bardzo dobry': 'Very good', 'Ślady użycia': 'Signs of wear', 'Uszkodzony': 'Damaged',
  'Nowy': 'New', 'Jak nowy': 'Like new', 'Doskonały': 'Excellent', 'Zadowalający': 'Fair',
  'Używany': 'Used', 'Używana': 'Used', 'Używane': 'Used', 'Nieznany': 'Unknown',
  "Dobry — rysy na obudowie, uchwyt kompletny": "Good — scratches on casing, side handle included",
  "Używany — ślady na obuchu, stabilny trzonek": "Used — marks on head, handle secure",
  "Dobry — powierzchowne ślady na szczękach": "Good — surface marks on jaws",
  "Dobry — ślady chwytu, akumulator i ładowarka w komplecie": "Good — grip marks, battery and charger included",
  "Używany — otarcia na kluczach, etui bez rozdarć": "Used — scuffs on spanners, pouch has no tears",
  "Dobry — ślady pracy, zatrzaski walizki całe": "Good — signs of use, case latches intact",
  "Używana — otarcia obudowy, osłona i rękojeść kompletne": "Used — scuffed casing, guard and handle included",
  "Dobry — drobne ślady na końcówkach": "Good — minor marks on tips",
  "Używane — część wierteł ma ślady ostrzenia": "Used — some drill bits show signs of sharpening",
  "Używane — ubytki lakieru, szczęki bez pęknięć": "Used — chipped paint, no cracks in jaws",
  "Dobry — ślady kleju na jednej podkładce": "Good — glue residue on one pad",
  "Używana — rysy na brzeszczocie, rękojeść cała": "Used — scratches on blade, handle intact",
  "Dobry — przyciemniony grot, podstawka w komplecie": "Good — darkened tip, stand included",
  "Dobry — lekkie rysy na osłonie wyświetlacza": "Good — light scratches on display cover",
  "Bardzo dobry — niewielkie ślady na podstawce": "Very good — minor marks on base",
  "Dobry — otarcia rękojeści": "Good — scuffed handles",
  "Dobry — drobne rysy, czytelna podziałka": "Good — minor scratches, scale clearly legible",
  "Używana — przybrudzone dno, sprawny zamek": "Used — dirty base, zip works",
  "Dobry — ślady nagrzewania na metalowej dyszy": "Good — heat marks on metal nozzle",
  "Używana — rysy na stopie, uchwyt bez uszkodzeń": "Used — scratches on base plate, handle undamaged",
  "Używana — pył w zakamarkach, worek bez rozdarć": "Used — dust in crevices, bag has no tears",
  "Dobry — otarcia stelaża, klosz cały": "Good — scuffed frame, shade intact",
  "Dobry — rysy na pokrywie, kompletne zawiasy": "Good — scratches on lid, all hinges present",
  "Używany — otarcia bębna, przewód bez widocznych przecięć": "Used — scuffed reel, no visible cuts in cable",
  "Dobry — otarcia lakieru, widoczne ślady na siodełku": "Good — scuffed paint, visible wear on saddle",
  "Dobry — drobne rysy podstawy, abażur cały": "Good — minor scratches on base, shade intact",
  "Używana — rysy na płycie wierzchniej, pokrowiec bez rozdarć": "Used — scratches on soundboard, case has no tears",
  "Dobry — ślady chwytu na obudowie, ładowarka w komplecie": "Good — grip marks on casing, charger included",
  "Bardzo dobry — drobne otarcie dolnej krawędzi ramy": "Very good — minor scuff on lower edge of frame",
  "Używany — pojedyncza rysa na blacie": "Used — a single scratch on tabletop",
  "Używany — zabrudzenie pokrowca, śledzie i stelaż w komplecie": "Used — dirty carry bag, pegs and poles included",
  "Używane — drobne zagięcia i otarcia okładek": "Used — minor creases and scuffs on covers",
  "Używane — zmechacenie tapicerki, komplet kółek": "Used — pilled upholstery, all castors present",
  "Używana — lekkie przebarwienie obudowy, dwa pady w komplecie": "Used — slight discoloration of casing, two controllers included",
  "Używana — rysy na pokrywie, zatrzaski całe": "Used — scratches on lid, latches intact",
  "Dobry — lekki ślad po kubku na górnym blacie": "Good — faint cup mark on top",
  "Dobry — drobne ślady na klawiszach, podpórka cała": "Good — minor marks on keys, music rest intact",
  "Dobry — jeden starszy liść z zaschniętym brzegiem": "Good — one older leaf has a dry edge",
  "Używany — niewielki osad wewnątrz, podstawa w komplecie": "Used — minor deposits inside, base included",
  "Dobry — rysy obudowy, komplet głównych akcesoriów": "Good — scratches on casing, main accessories included",
  "Dobry — rysy na osłonie wyświetlacza, obiektyw bez widocznych pęknięć": "Good — scratches on display cover, no visible cracks in lens",
  "Używany — lekko spłaszczone runo w jednym miejscu": "Used — pile slightly flattened in one spot",
  "Dobry — drobne rysy na obudowie": "Good — minor scratches on casing",
  "Dobry — lekkie otarcie podstawy": "Good — light scuff on base",
  "Używane — otarcia powłoki przy końcach": "Used — scuffed coating near the ends",
  "Używane — wytarte owijki, naciągi bez widocznych zerwań": "Used — worn grips, no visibly broken strings",
  "Dobry — rysa na boku, talerz bez uszkodzeń": "Good — scratch on side, turntable undamaged",
  "Używane — ślady na dnach, uchwyty i pokrywki kompletne": "Used — marks on bases, handles and lids included",
  "Dobry — otarcia pokrywy i wytarte klawisze, zasilacz w komplecie": "Good — scuffed lid and worn keys, power adapter included",
  "Dobry — drobne rysy na podstawie, komplet przewodów": "Good — minor scratches on stand, all cables included",
  "Używany — przetarta tapicerka podłokietników, komplet kółek": "Used — worn armrest upholstery, all castors present",
  "Dobry — rysy na boku obudowy, kompletna osłona": "Good — scratches on side of case, cover intact",
  "Używana — otarcia obudowy, toner o nieustalonym zużyciu": "Used — scuffed casing, toner level unknown",
  "Dobry — drobne ślady na pokrywie, szyba bez widocznych pęknięć": "Good — minor marks on lid, no visible cracks in glass",
  "Używany — otarcia obudowy, czas pracy lampy nieustalony": "Used — scuffed casing, lamp hours unknown",
  "Dobry — rysy przy jednej krawędzi blatu": "Good — scratches along one edge of tabletop",
  "Używany — otarcia frontów, bez kluczyka do zamka": "Used — scuffed drawer fronts, lock key missing",
  "Dobry — ślady po ramieniu monitora na krawędzi": "Good — monitor arm marks on edge",
  "Dobry — lekkie przebarwienie obudowy, zasilacz w komplecie": "Good — slight discoloration of casing, power adapter included",
  "Dobry — rysy na spodzie, przewód zasilający w komplecie": "Good — scratches underneath, power cable included",
  "Używane — otarcia zacisku, komplet głównych elementów": "Used — scuffed clamp, main parts included",
  "Dobry — ślady na pokrywie, zasilacz w komplecie": "Good — marks on cover, power adapter included",
  "Używana — drobne rysy kosza, pokrywa bez pęknięć": "Used — minor scratches on bin, no cracks in lid",
  "Używany — ślady kamienia na tacce, zbiornik cały": "Used — limescale marks on tray, tank intact",
  "Dobry — wgniecenie na boku, komplet półek": "Good — dent on side, all shelves present",
  "Używany — otarcia półek, komplet podpórek": "Used — scuffed shelves, all shelf supports present",
  "Dobry — rysy podstawy, przewód bez widocznych uszkodzeń": "Good — scratches on base, no visible damage to cable",
  "Używana — delikatne ślady po pisakach i rysa na ramie": "Used — faint marker residue and scratch on frame",
  "Używane — otarcia nóg i niewielkie przetarcia siedzisk": "Used — scuffed legs and minor wear to seats",
  "Używane — pozostałości etykiet, pojemniki bez pęknięć": "Used — label residue, no cracks in containers",
  "Używany — rysy na obudowie, zużycie akumulatora nieustalone": "Used — scratches on casing, battery condition unknown",
  "Dobry — otarcie uchwytu, osłona obiektywu bez widocznych rys": "Good — scuffed mount, no visible scratches on lens cover",
  "Dobry — drobne ślady na okładce": "Good — minor wear on cover",
  "Dobry — niewielkie ślady czytania": "Good — light signs of reading",
};
export function displayCondition(value: string): string {
  const label = legacyConditions[value];
  return typeof label === 'string' ? label : value;
}

export function Button({ children, variant = 'primary', busy, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; variant?: 'primary' | 'secondary' | 'text' | 'danger'; busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`button button-${variant} ${className}`} aria-busy={busy || undefined}>{busy ? <Loader2 size={19} className="spin" /> : null}{children}</button>;
}
export function LinkButton({ children, onClick, className = '', disabled }: { children: ReactNode; onClick: () => void; className?: string; disabled?: boolean }) {
  return <button type="button" className={`text-link ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function GateNote({ gate, fallback }: { gate?: ActionGate; fallback?: string }) {
  const text = gate && !gate.allowed ? gate.reason : fallback;
  return text ? <p className="caption gate-note">{text}</p> : null;
}
export function Notice({ children, tone = 'info', className = '' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' | 'error'; className?: string }) {
  const Icon = tone === 'success' ? Check : tone === 'warning' || tone === 'error' ? AlertCircle : Info;
  return <div className={`notice notice-${tone} ${className}`} role={tone === 'error' ? 'alert' : undefined}><Icon size={23} strokeWidth={1.8} /><div>{children}</div></div>;
}
export function PageHeading({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{subtitle ? <p className="page-subtitle">{subtitle}</p> : null}</div>{children}</div>;
}
// A few generated atlas objects cross the regular 6 × 4 cell bounds.
// Source-pixel rectangles preserve the complete object without including its neighbour.
const exampleAtlasCrops: Record<string, readonly [number, number, number, number]> = {
  '/assets/examples/home/atlas.png#tile=01': [0, 34, 240, 360],
  '/assets/examples/office/atlas.png#tile=08': [216, 314, 220, 330],
  '/assets/examples/workshop/atlas.png#tile=09': [420, 326, 184, 276],
  '/assets/examples/workshop/atlas.png#tile=18': [1007, 625, 247, 300],
};
export function ItemImage({ src, alt, className = '', loading = 'lazy' }: { src: string; alt: string; className?: string; loading?: 'eager' | 'lazy' }) {
  const atlas = /^(\/assets\/examples\/(?:workshop|home|office|vinyl|books)\/atlas\.png)#tile=(\d{2})$/.exec(src);
  const index = atlas ? Number(atlas[2]) - 1 : -1;
  if (!atlas || index < 0 || index >= 24) return <img src={src} alt={alt} className={className || undefined} loading={loading} />;
  const crop = exampleAtlasCrops[src];
  const cropUnits = crop?.map(value => value / 209);
  const viewBox = cropUnits ? cropUnits.join(' ') : `${index % 6} ${Math.floor(index / 6) * 1.5} 1 1.5`;
  const atlasImage = <image href={atlas[1]} width="6" height="6" preserveAspectRatio="none" />;
  return <svg className={`item-image ${className}`} viewBox={viewBox} role="img" aria-label={alt} xmlns="http://www.w3.org/2000/svg">
    <title>{alt}</title>{cropUnits ? <svg x={cropUnits[0]} y={cropUnits[1]} width={cropUnits[2]} height={cropUnits[3]} viewBox={viewBox} overflow="hidden">{atlasImage}</svg> : atlasImage}
  </svg>;
}
export function ItemGrid({ items, selectedIds, onToggle, onDetail, compact, allSelected, highlightIds }: {
  items: PublicItem[]; selectedIds?: string[]; onToggle?: (id: string) => void; onDetail?: (id: string) => void;
  compact?: boolean; allSelected?: boolean; highlightIds?: string[];
}) {
  const selected = new Set(selectedIds);
  return <div className={`item-grid ${compact ? 'item-grid-compact' : ''}`}>{items.map(item => {
    const checked = allSelected || selected.has(item.id);
    const photo = <><ItemImage src={item.imageUrl} alt={item.name} />{onToggle && checked ? <span className="item-check"><Check size={18} strokeWidth={2.6} /></span> : null}</>;
    return <figure className={`item ${checked ? 'is-selected' : ''} ${highlightIds?.includes(item.id) ? 'is-changed' : ''}`} key={item.id}>
      {onToggle || onDetail ? <button type="button" className="item-photo" onClick={() => onToggle ? onToggle(item.id) : onDetail?.(item.id)} aria-label={onToggle ? `${checked ? 'Remove' : 'Select'} item #${item.id}: ${item.name}` : `View item #${item.id}: ${item.name}`} aria-pressed={onToggle ? checked : undefined}>{photo}</button> : <div className="item-photo">{photo}</div>}
      <figcaption><span className="item-caption-main">{onDetail ? <button onClick={() => onDetail(item.id)} className="item-id" aria-label={`Details of item #${item.id}: ${item.name}`}>#{item.id}</button> : <span className="item-id">#{item.id}</span>}<span className="item-name" title={item.name}>{item.name}</span></span>{highlightIds?.includes(item.id) ? <span className="item-change-label">Changed</span> : null}</figcaption>
    </figure>;
  })}</div>;
}
export function CostRows({ rows, total }: { rows: { label: string; cents: number }[]; total?: { label: string; cents: number } }) {
  return <div className="cost-rows">{rows.map(row => <div className="cost-row" key={row.label}><span>{row.label}</span><span>{money(row.cents)}</span></div>)}{total ? <div className="cost-row cost-total"><strong>{total.label}</strong><strong>{money(total.cents)}</strong></div> : null}</div>;
}
export function ProgressBar({ value, total, label }: { value: number; total: number; label: string }) {
  return <div className="progress-section"><h2>{label} {value} of {total}</h2><div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total} aria-label={label}><span style={{ width: `${total ? value / total * 100 : 0}%` }} /></div></div>;
}
export function Status({ status, kind = 'operation', preserved }: { status?: OperationStatus | 'accepted' | 'waiting'; kind?: 'operation' | 'authorization' | 'capture' | 'refund' | 'void'; preserved?: boolean }) {
  let label = 'Not started'; let tone = 'muted'; let Icon = Minus;
  if (status === 'accepted') { label = preserved ? 'Terms unchanged' : 'Accepted'; tone = 'success'; Icon = Check; }
  else if (status === 'AUTHORIZED') { label = 'Authorized'; tone = 'success'; Icon = Check; }
  else if (status === 'COMPLETED') { label = kind === 'refund' ? 'Refund confirmed' : kind === 'authorization' ? 'Ready' : 'Captured'; tone = 'success'; Icon = Check; }
  else if (status === 'VOIDED') { label = 'Hold released'; tone = 'success'; Icon = Check; }
  else if (status === 'UNKNOWN') { label = 'Checking result'; tone = 'warning'; Icon = Clock3; }
  else if (status === 'PENDING' || status === 'STARTED') { label = kind === 'refund' ? 'Refund in progress' : kind === 'void' ? 'Cancellation in progress' : 'Awaiting result'; tone = 'waiting'; Icon = Clock3; }
  else if (status === 'FAILED') { label = kind === 'refund' ? 'Refund needs review' : 'Failed'; tone = 'error'; Icon = AlertCircle; }
  else if (status === 'CANCELLED') { label = 'Cancelled'; tone = 'muted'; Icon = Minus; }
  else if (status === 'CREATED' || status === 'APPROVED') { label = 'Incomplete'; tone = 'waiting'; Icon = Clock3; }
  else if (status === 'waiting') { label = 'Waiting'; tone = 'waiting'; Icon = Clock3; }
  return <span className={`status status-${tone}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></span>;
}
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy }: { title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return <div className="modal-backdrop" onClick={onCancel}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={event => event.stopPropagation()}><h2 id="confirm-title">{title}</h2><div className="dialog-copy">{children}</div><Button variant="danger" onClick={onConfirm} busy={busy}>{confirmLabel}</Button><Button variant="text" onClick={onCancel}>Back</Button></section></div>;
}
export function NextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="next-link" onClick={onClick}>{children}<ChevronRight size={18} /></button>; }
