import {useEffect,useId,useState,type ButtonHTMLAttributes,type ReactNode} from 'react';
import { AlertCircle, Check, Clock3, Info, Loader2, MapPin, Package, CalendarDays, UserRound, Minus } from 'lucide-react';
import type { Collection, PublicCollection, CollectionItem, PublicItem, ImageRegion } from '../../shared/types';
import { ItemImage } from '../components';

export const money=(cents:number)=>`${new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(cents/100)} PLN`;
export const date=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
export const localInput=(iso:string)=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function B({children,variant='primary',busy,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'text'|'danger'|'paypal';busy?:boolean}){
  return <button {...props} className={`v-button v-${variant} ${props.className??''}`} disabled={props.disabled||busy} aria-busy={busy||undefined}>{busy?<Loader2 className="v-spin" size={18}/>:null}{children}</button>;
}
export function Note({children,tone='info'}:{children:ReactNode;tone?:'info'|'ok'|'warn'|'error'}){
  const Icon=tone==='ok'?Check:tone==='warn'||tone==='error'?AlertCircle:Info;
  return <div className={`v-note v-note-${tone}`} role={tone==='error'?'alert':undefined}><Icon size={19} strokeWidth={1.7}/><div>{children}</div></div>;
}
export function Status({children,tone='wait'}:{children:ReactNode;tone?:'ok'|'wait'|'error'|'none'}){
  const Icon=tone==='ok'?Check:tone==='error'?AlertCircle:tone==='none'?Minus:Clock3;
  return <span className={`v-status v-status-${tone}`}><span><Icon size={12} strokeWidth={2}/></span>{children}</span>;
}
export function Heading({title,subtitle,children}:{title:string;subtitle?:ReactNode;children?:ReactNode}){
  return <div className="v-heading"><h1>{title}</h1>{subtitle?<p className="v-subtitle">{subtitle}</p>:null}{children}</div>;
}
const photoAspects=new Map<string,Promise<number>>();
function photoAspect(src:string){
  let pending=photoAspects.get(src);
  if(!pending){pending=new Promise<number>(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth/image.naturalHeight||1);image.onerror=()=>resolve(1);image.src=src;});photoAspects.set(src,pending);}
  return pending;
}
export function Photo({src,alt,className='',region}:{src:string;alt:string;className?:string;region?:ImageRegion}){
  const clipId='photo-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const [aspect,setAspect]=useState(1);
  const cropped=!!region;
  useEffect(()=>{let active=true;if(cropped)void photoAspect(src).then(value=>{if(active)setAspect(value);});return()=>{active=false;};},[src,cropped]);
  if(region)return <span className={`v-photo ${className}`}><svg className="v-region-image" viewBox={`0 0 ${region.width*aspect} ${region.height}`} role="img" aria-label={alt}><title>{alt}</title><defs><clipPath id={clipId}><rect width={region.width*aspect} height={region.height}/></clipPath></defs><image href={src} x={-region.x*aspect} y={-region.y} width={aspect} height="1" preserveAspectRatio="none" clipPath={`url(#${clipId})`}/></svg></span>;
  const cell=/^(.*\.png)#cell=([0-3])$/.exec(src);
  return cell?<span role="img" aria-label={alt} className={`v-photo v-sprite ${className}`} style={{backgroundImage:`url("${cell[1]}")`,backgroundPosition:`${Number(cell[2])%2*100}% ${Math.floor(Number(cell[2])/2)*100}%`}}/>:<span className={`v-photo ${className}`}><ItemImage src={src} alt={alt}/></span>;
}
export function Basket({items,ids,withPhoto=true,changes=[]}:{items:(CollectionItem|PublicItem)[];ids:string[];withPhoto?:boolean;changes?:string[]}){
  return <div className="v-basket">{ids.map(id=>{const item=items.find(i=>i.id===id);if(!item)return null;return <div key={id} className={`v-item-row ${changes.includes(id)?'v-added':''}`}>
    {withPhoto?<Photo src={item.imageUrl} alt={item.name} region={item.imageRegion}/>:null}<span className="v-item-name">{changes.includes(id)?'+ ':''}{item.name}{!withPhoto?<small>#{id}</small>:null}</span><strong>{money('shareCents' in item?item.shareCents:item.fixedPriceCents??0)}</strong>
  </div>;})}</div>;
}
export function Total({label,value}:{label:string;value:number}){return <div className="v-total"><strong>{label}</strong><strong>{money(value)}</strong></div>;}
export function Terms({collection,deadline,recipient=true}:{collection:Collection|PublicCollection;deadline?:string;recipient?:boolean}){
  return <div className="v-terms">{recipient?<div><UserRound/><span>Recipient: <strong>{collection.seller?.name??'Alex'} · Seller</strong></span></div>:null}
    <div><Package/><span>Whole lot: {collection.items.length} items · {money(collection.totalCents)}</span></div>
    <div><CalendarDays/><span>Agree by {date(deadline??collection.reservationExpiresAt)}</span></div>
    {collection.pickup?<div><MapPin/><span>Pickup: {date(collection.pickup.startsAt)} – {new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit'}).format(new Date(collection.pickup.endsAt))}<br/>{collection.pickup.location}</span></div>:null}
  </div>;
}
export function SandboxTag({mode='sandbox'}:{mode?:'rehearsal'|'sandbox'}){return <span className="v-sandbox">{mode==='rehearsal'?'Simulated':'Sandbox'}</span>;}
export async function copyLink(link:string){await navigator.clipboard.writeText(new URL(link,window.location.origin).href);}
export async function fileData(file:File):Promise<string>{
  if(file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG or WebP photo up to 8 MB.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('The photo could not be read.'));reader.readAsDataURL(file);});
}
