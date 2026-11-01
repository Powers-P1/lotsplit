import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainError} from './domain.js';

/** Store uploaded pixels once. Views and polling carry a protected URL, never megabytes of base64. */
export async function storePhoto(directory:string,value:unknown):Promise<string>{
  if(typeof value!=='string'||value.length>12_000_000)throw new DomainError('INVALID_PHOTO','Choose a PNG, JPEG or WebP photo up to 8 MB.');
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)throw new DomainError('INVALID_PHOTO','Choose a PNG, JPEG or WebP photo.');
  const bytes=Buffer.from(match[2],'base64');const mime=match[1];
  const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid||!bytes.length||bytes.length>8*1024*1024||bytes.toString('base64').replace(/=+$/,'')!==match[2].replace(/=+$/,''))throw new DomainError('INVALID_PHOTO','The file does not match its image type.');
  await mkdir(directory,{recursive:true});
  const sizes=await Promise.all((await readdir(directory)).map(async name=>(await stat(join(directory,name))).size));
  if(sizes.reduce((sum,n)=>sum+n,0)+bytes.length>256*1024*1024)throw new DomainError('PHOTO_STORAGE_FULL','This workspace has reached its photo storage limit. Use smaller photos.',413);
  const filename=`${randomUUID()}.${mime==='image/jpeg'?'jpg':mime.slice(6)}`;
  await writeFile(join(directory,filename),bytes,{flag:'wx',mode:0o600});return `/api/photos/${filename}`;
}
export async function loadPhoto(directory:string,filename:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp)$/.test(filename))throw new DomainError('PHOTO_NOT_FOUND','Photo not found.',404);
  try{return {bytes:await readFile(join(directory,filename)),mime:filename.endsWith('.jpg')?'image/jpeg':filename.endsWith('.png')?'image/png':'image/webp'};}
  catch{throw new DomainError('PHOTO_NOT_FOUND','Photo not found.',404);}
}
