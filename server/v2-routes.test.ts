import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {createApiRouter} from './routes.js';
import {LotSplitEngine,type DomainState} from './domain.js';
import {SqliteStore} from './store.js';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function fixture(t:TestContext){
 const dir=mkdtempSync(join(tmpdir(),'lotsplit-v2-route-'));const store=new SqliteStore<DomainState>(':memory:');
 const engine=new LotSplitEngine(store,{mode:'rehearsal',conceptVersion:2});const app=express();app.use(express.json({limit:'12mb'}));
 app.use('/api',createApiRouter(engine,{photoDirectory:join(dir,'photos')}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');const base=`http://127.0.0.1:${address.port}`;
 t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&basename(dir).startsWith('lotsplit-v2-route-'));rmSync(dir,{recursive:true,force:true});});
 const call=(path:string,data?:unknown,cookie?:string,method='POST',origin=base)=>fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const login=async(id:string)=>{const r=await call('/auth/demo',{inviteToken:`demo-${id}`});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];};
 return {dir,store,engine,call,login};
}

test('V2 uploaded photos are owner-only writes, authenticated reads, byte-identical and stored once behind a URL',async t=>{
 const {engine,call,login}=await fixture(t);const owner=await login('kasia'),buyer=await login('maja');
 assert.equal((await call('/v2/photos',{imageDataUrl:png})).status,401);
 assert.equal((await call('/v2/photos',{imageDataUrl:png},buyer)).status,403);
 const r=await call('/v2/photos',{imageDataUrl:png},owner);assert.equal(r.status,200);const value=await r.json() as {photoUrl:string};assert.match(value.photoUrl,/^\/api\/photos\/[a-f0-9-]+\.png$/);
 const path=value.photoUrl.slice('/api'.length);assert.equal((await call(path,undefined,undefined,'GET')).status,401);
 const read=await call(path,undefined,buyer,'GET');assert.equal(read.status,200);assert.equal(read.headers.get('content-type'),'image/png');assert.match(read.headers.get('cache-control')??'',/no-store/);
 assert.deepEqual(Buffer.from(await read.arrayBuffer()),Buffer.from(png.split(',')[1],'base64'));
 const deadline=new Date(Date.now()+86400000).toISOString(),start=new Date(Date.now()+172800000).toISOString(),end=new Date(Date.now()+180000000).toISOString();
 const created=await call('/v2/lot',{name:'Own uploaded sale',photos:[value.photoUrl],buyerCount:2,collectionPriceCents:10000,reservationExpiresAt:deadline,pickup:{location:'Test pickup',startsAt:start,endsAt:end}},owner);
 assert.equal(created.status,200);assert.equal(engine.snapshot().collection.photos[0],value.photoUrl);assert.equal(JSON.stringify(engine.view('kasia')).includes('data:image/'),false);
});

test('V2 photo transport rejects mismatched bytes, text/SVG and unsafe filenames without accepting a catalogue',async t=>{
 const {dir,engine,call,login}=await fixture(t);const owner=await login('kasia');const before=engine.snapshot();
 for(const bad of ['data:text/html;base64,PHNjcmlwdD4=','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,aGVsbG8='])assert.equal((await call('/v2/photos',{imageDataUrl:bad},owner)).status,400);
 assert.equal((await call('/photos/not-a-safe-file.png',undefined,owner,'GET')).status,404);
 assert.deepEqual(engine.snapshot(),before);assert.deepEqual(readdirSync(dir),[]);
});

test('V2 option endpoint binds to the buyer session and hides private limits from the seller',async t=>{
 const {engine,call,login}=await fixture(t);await engine.setScenario('kasia','collecting');const owner=await login('kasia'),jan=await login('ola');
 const before=engine.snapshot().participants.find(p=>p.id==='maja')!.preferences;
 const saved=await call('/v2/options',{buyerId:'maja',basketOptions:[['04','12']],budgetCents:51234,description:'My private limit is 51234',confirmed:true},jan,'PUT');assert.equal(saved.status,200);
 assert.deepEqual(engine.snapshot().participants.find(p=>p.id==='maja')!.preferences,before);assert.equal(engine.snapshot().participants.find(p=>p.id==='ola')!.preferences!.budgetCents,51234);
 const seller=await(await call('/state',undefined,owner,'GET')).text();assert.equal(seller.includes('51234'),false);
 const rejected=await call('/v2/options',{basketOptions:[['01']],budgetCents:30000,confirmed:true},jan,'PUT','https://untrusted.test');assert.equal(rejected.status,403);
});

test('V2 invitation email must match and buyer cannot create, send or forge an agent question',async t=>{
 const {engine,call,login}=await fixture(t);await engine.setScenario('kasia','collecting');const buyer=await login('ola');const before=engine.snapshot();
 assert.equal((await call('/ai/assistant',{},buyer)).status,403);
 assert.equal((await call('/v2/questions/not-a-question/send',{},buyer)).status,403);
 assert.equal((await call('/auth/request-link',{email:'somebody@lotsplit.example',inviteToken:'demo-ola'})).status,401);
 assert.deepEqual(engine.snapshot(),before);
});
