const test=require('node:test');const assert=require('node:assert/strict');
const plugin=require('./plugin.js');
const rpc=(id,value)=>")]}'\n100\n"+JSON.stringify([['wrb.fr',id,JSON.stringify(value)]]);
const answer=(text,type)=>[['wrb.fr',null,JSON.stringify([[text,null,['conversation'],null,[null,null,null,[],type]]])]];
function fake(){
 const stored=new Map();const calls=[];let creates=0,uploads=0;
 const api={call:async(method,input)=>{
  calls.push([method,input]);
  if(method==='storage.claim'){const prior=stored.get(input.key)??null;if(!prior)stored.set(input.key,JSON.parse(JSON.stringify(input.value)));return prior;}
  if(method==='storage.get')return stored.get(input.key)??null;
  if(method==='storage.set'){stored.set(input.key,JSON.parse(JSON.stringify(input.value)));return true;}
  if(method==='reader.currentChapter')return {bookId:1,title:'Book',chapter:'Chapter',text:'La ira se fue.'};
  if(method==='network.request'){
   if(!input.method)return {body:'{"SNlM0e":"test-csrf","FdrFJe":"sid","cfb2h":"build"}',sessionScope:'scope',url:'https://notebook.google.com/'};
   const id=new URL(input.url).searchParams.get('rpcids');
   if(id==='wXbhsf')return {body:rpc(id,[[['Book',[],'notebook-1']]])};
   if(id==='CCqFvf'){creates++;return {body:rpc(id,['Book',[],'notebook-1'])};}
   if(id==='izAoDd'){uploads++;return {body:rpc(id,[[[['source-1'],'Chapter']]])};}
   throw Error('Unexpected RPC');
  }
  throw Error('Unexpected API');
 }};
 return {api,calls,stored,counts:()=>({creates,uploads})};
}
test('parses Google RPC framing and rejects RPC errors',()=>{
 assert.deepEqual(plugin.parseRpc(rpc('id',[1,2]),'id'),[1,2]);
 assert.throws(()=>plugin.parseRpc(JSON.stringify([['er','id',16]]),'id'));
 assert.throws(()=>plugin.parseRpc('<html>Sign in</html>','id'));
});
test('returns final answer only, never a longer thinking frame',()=>{
 const text=JSON.stringify(answer('secret thinking'.repeat(20),2))+'\n'+JSON.stringify(answer('Final answer',1));
 assert.equal(plugin.parseAnswer(text).answer,'Final answer');
 assert.throws(()=>plugin.parseAnswer(JSON.stringify(answer('thinking',2))));
});
test('extracts source IDs and prefers download audio variants',()=>{
 assert.deepEqual(plugin.sourceIds([['Book',[[['s1'],'Title']], 'id']]),['s1']);
 const row=[null,null,1,null,3,null,[null,null,null,'https://fallback',null,[['https://media=m140',null,'audio/mp4'],['https://media=m140-dv',null,'audio/mp4']]]];
 assert.equal(plugin.audioUrl(row),'https://media=m140-dv');
});
test('list notebooks is read-only and does not expose session tokens',async()=>{
 const f=fake();const result=await plugin.invoke('notebooks',{},f.api);
 assert.equal(result.notebooks[0].notebookId,'notebook-1');
 assert(!JSON.stringify(result).includes('test-csrf'));
 assert.equal(f.calls.filter(([m])=>m.startsWith('reader.')).length,0);
});
test('upload retries reuse the receipt instead of duplicating a notebook/source',async()=>{
 const f=fake();const args={operationId:'upload-1',scope:'chapter'};
 const first=await plugin.invoke('upload',args,f.api);
 assert.equal(first.uploadedSources[0].sourceId,'source-1');
 assert.deepEqual(await plugin.invoke('upload',args,f.api),first);
 assert.deepEqual(f.counts(),{creates:1,uploads:1});
 await assert.rejects(plugin.invoke('upload',{...args,title:'Changed'},f.api));
});
test('ambiguous creation is not replayed and retains partial progress',async()=>{
 const f=fake();const original=f.api.call;
 f.api.call=async(method,input)=>{
  if(method==='network.request'&&input.method&&new URL(input.url).searchParams.get('rpcids')==='izAoDd')throw Error('connection lost');
  return original(method,input);
 };
 const args={operationId:'upload-2'};
 const failed=await plugin.invoke('upload',args,f.api);
 assert.equal(failed.uncertain,true);assert.equal(failed.notebookId,'notebook-1');
 const again=await plugin.invoke('upload',args,f.api);
 assert.equal(again.uncertain,true);assert.equal(f.counts().creates,1);
});
test('missing login gives an actionable error without trying a mutation',async()=>{
 await assert.rejects(plugin.invoke('notebooks',{}, {call:async()=>({body:'<html>Login</html>'})}),/Sign in/);
});

test('concurrent retries claim the operation atomically',async()=>{
 const f=fake();const args={operationId:'simultaneous'};
 const results=await Promise.all([plugin.invoke('upload',args,f.api),plugin.invoke('upload',args,f.api)]);
 assert.equal(f.counts().creates,1);assert.equal(f.counts().uploads,1);
 assert(results.some(r=>r.uncertain===true));
});

test('audio creation records one submitted job and reuses its receipt',async()=>{
 const f=fake(),original=f.api.call;let generations=0;
 f.api.call=async(method,input)=>{
  const id=method==='network.request'&&input.method?new URL(input.url).searchParams.get('rpcids'):null;
  if(id==='rLM1Ne')return {body:rpc(id,[['Book',[[['s1'],'Source']],'notebook-1']])};
  if(id==='R7cb6c'){
   generations++;
   const request=JSON.parse(new URLSearchParams(input.body).get('f.req'));
   assert(JSON.stringify(request).includes('es'));
   return {body:rpc(id,[['artifact-1']])};
  }
  return original(method,input);
 };
 const args={notebookId:'notebook-1',operationId:'audio-1',language:'es'};
 const result=await plugin.invoke('audio',args,f.api);
 assert.equal(result.status,'submitted');assert.equal(result.artifactId,'artifact-1');
 assert.deepEqual(await plugin.invoke('audio',args,f.api),result);assert.equal(generations,1);
});

test('download accepts only an existing completed audio artifact from fresh status',async()=>{
 const f=fake(),original=f.api.call;const downloads=[];
 f.api.call=async(method,input)=>{
  const id=method==='network.request'&&input.method?new URL(input.url).searchParams.get('rpcids'):null;
  if(id==='gArtLc')return {body:rpc(id,[[['artifact-1','Audio',1,null,3,null,[null,null,null,null,null,[['https://lh3.googleusercontent.com/audio=m140-dv',null,'audio/mp4']]]]]])};
  if(method==='files.download'){downloads.push(input);return {id:'local-audio',bytes:123};}
  return original(method,input);
 };
 await assert.rejects(plugin.invoke('download',{notebookId:'notebook-1',artifactId:'invented'},f.api),/not ready/);
 assert.equal(downloads.length,0);
 const result=await plugin.invoke('download',{notebookId:'notebook-1',artifactId:'artifact-1'},f.api);
 assert.equal(result.id,'local-audio');assert.equal(downloads.length,1);
 assert.equal(downloads[0].url,'https://lh3.googleusercontent.com/audio=m140-dv');
});
