/* NotebookLM wire format adapted from notebooklm-mcp-cli 0.16.1 (MIT).
 * See THIRD_PARTY_NOTICE.md in the repository and LICENSE in the package.
 * This module runs in Anx's restricted JS runtime, not in a book WebView. */
'use strict';

const RPC = { list:'wXbhsf', get:'rLM1Ne', create:'CCqFvf', add:'izAoDd', audio:'R7cb6c', status:'gArtLc' };
const QUERY = '/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed';
function required(value, name, max=1000) {
  if(typeof value!=='string'||!value.trim()||value.length>max) throw Error(`${name} is required (maximum ${max} characters)`);
  return value.trim();
}
function notebookId(value) {
  const id=required(value,'notebookId',100);
  if(!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('Invalid notebookId');
  return id;
}
function frames(text) {
  const result=[];
  function visit(value) {
    if(!Array.isArray(value))return;
    if(value[0]==='wrb.fr'||value[0]==='er'){result.push(value);return;}
    for(const item of value)visit(item);
  }
  for(const line of text.replace(/^\)\]\}'/,'').split('\n')) {
    if(!line.trim().startsWith('['))continue;
    try{visit(JSON.parse(line));}catch(_){/* byte lengths and incomplete frames are not payloads */}
  }
  return result;
}
function parseRpc(text, id) {
  const rows=frames(text);
  if(rows.some(row=>row[0]==='er'&&(row[1]===id||row[1]==null))) {
    throw Error('Google rejected the request. Check sign-in, limits and notebook access; do not blindly repeat a creation.');
  }
  const row=rows.find(row=>row[0]==='wrb.fr'&&row[1]===id&&typeof row[2]==='string');
  if(!row)throw Error('NotebookLM response changed or sign-in expired. No successful operation is confirmed.');
  const value=JSON.parse(row[2]);
  if(value==null)throw Error('Google returned no operation result. Check NotebookLM before retrying.');
  return value;
}
function sourceIds(value) {
  const sources=value?.[0]?.[1];
  return Array.isArray(sources)?sources.map(source=>source?.[0]?.[0]).filter(id=>typeof id==='string'):[];
}
function parseAnswer(text) {
  let answer=null;
  for(const row of frames(text)) {
    if(row[0]!=='wrb.fr'||typeof row[2]!=='string')continue;
    let data;try{data=JSON.parse(row[2]);}catch(_){continue;}
    const node=data?.[0], type=node?.[4];
    // Never expose thinking (type2) as the answer.
    if(!Array.isArray(type)||type[type.length-1]!==1||typeof node[0]!=='string')continue;
    if(answer&&answer.answer.length>=node[0].length)continue;
    const citations={};
    if(Array.isArray(type[3]))type[3].forEach((passage,index)=>{
      const id=passage?.[1]?.[5]?.[0]?.[0]?.[0];
      if(typeof id==='string')citations[index+1]=id;
    });
    answer={answer:node[0],conversationId:node?.[2]?.[0]??null,citations};
  }
  if(!answer?.answer)throw Error('NotebookLM returned no final answer. Check sign-in or retry the question.');
  return answer;
}
async function session(api) {
  const response=await api.call('network.request',{url:'https://notebook.google.com/'});
  const field=name=>{
    const match=response.body.match(new RegExp('"'+name+'"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")'));
    return match?JSON.parse(match[1]):'';
  };
  const csrf=field('SNlM0e'), sid=field('FdrFJe'), bl=field('cfb2h');
  if(!csrf)throw Error('Sign in to NotebookLM in Settings → AI → Extensions → NotebookLM → Sign in, then return to Anx.');
  const base=new URL(response.url||'https://notebook.google.com/').origin;
  const send=async(url,body)=>api.call('network.request',{url,method:'POST',body,sessionScope:response.sessionScope});
  return {
    base,scope:response.sessionScope||'session',
    async rpc(id,params,notebook){
      const query=new URLSearchParams({rpcids:id,'source-path':notebook?`/notebook/${notebook}`:'/',bl,hl:'en',rt:'c'});
      if(sid)query.set('f.sid',sid);
      const form=new URLSearchParams({'f.req':JSON.stringify([[[id,JSON.stringify(params),null,'generic']]]),at:csrf});
      const result=await send(`${base}/_/LabsTailwindUi/data/batchexecute?${query}`,form.toString()+'&');
      return parseRpc(result.body,id);
    },
    async ask(id,question,sources){
      const conversation=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});
      const params=[sources.map(s=>[[s]]),question,null,[2,null,[1]],conversation];
      const form=new URLSearchParams({'f.req':JSON.stringify([null,JSON.stringify(params)]),at:csrf});
      const query=new URLSearchParams({bl,hl:'en',rt:'c',_reqid:String(Date.now()%1000000000)});
      if(sid)query.set('f.sid',sid);
      return parseAnswer((await send(base+QUERY+'?'+query,form.toString()+'&')).body);
    },
  };
}
async function once(api,s,args,operation) {
  const id=required(args.operationId,'operationId',60);
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('operationId must use letters, numbers, underscore or hyphen');
  const key=`receipt_${s.scope.slice(0,16)}_${id}`;
  const signature=JSON.stringify(args);
  const previous=await api.call('storage.claim',{key,value:{signature,state:'started',progress:{}}});
  if(previous){
    if(previous.signature!==signature)throw Error('operationId was reused with different arguments');
    if(previous.state==='done')return previous.result;
    return {uncertain:true,...previous.progress,message:'An earlier attempt started. It may have completed. Check NotebookLM/status before creating anything again.'};
  }
  let progress={};
  const update=async value=>{progress={...progress,...value};await api.call('storage.set',{key,value:{signature,state:'started',progress}});};
  await update({});
  try {
    const result=await operation(update);
    await api.call('storage.set',{key,value:{signature,state:'done',result}});
    return result;
  }catch(error){
    return {uncertain:true,...progress,message:String(error)+' Check the notebook before retrying; do not start another creation automatically.'};
  }
}
function audioUrl(row) {
  const options=row?.[6];const media=options?.[5];
  if(Array.isArray(media)) {
    const valid=media.filter(item=>typeof item?.[0]==='string'&&item?.[2]==='audio/mp4');
    return valid.find(item=>item[0].endsWith('-dv'))?.[0]||valid[0]?.[0]||null;
  }
  return typeof options?.[3]==='string'?options[3]:null;
}
async function statuses(s,id) {
  const raw=await s.rpc(RPC.status,[[2],id,'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'],id);
  if(!Array.isArray(raw?.[0]))throw Error('Unexpected studio response');
  return raw[0].filter(row=>Array.isArray(row)&&typeof row[0]==='string').map(row=>{
    const url=row[2]===1?audioUrl(row):null;
    return {artifactId:row[0],title:row[1],type:row[2],
      status:row[4]===3||(row[4]===2&&url)?'completed':row[4]===1?'in_progress':row[4]===4?'failed':'unknown',
      audioUrl:url};
  });
}
async function invoke(name,args,api) {
  const s=await session(api);
  if(name==='notebooks') {
    const result=await s.rpc(RPC.list,[null,1,null,[2]]);
    if(!Array.isArray(result?.[0]))throw Error('Unexpected notebook list response');
    return {notebooks:result[0].filter(row=>Array.isArray(row)&&typeof row[2]==='string')
      .slice(0,100).map(row=>({notebookId:row[2],title:row[0],sourceCount:Array.isArray(row[1])?row[1].length:0}))};
  }
  if(name==='upload') {
    const scope=args.scope??'chapter';
    if(!['chapter','book'].includes(scope))throw Error('scope must be chapter or book');
    if(args.notebookId)notebookId(args.notebookId);
    return once(api,s,args,async update=>{
    const book=await api.call(scope==='book'?'reader.bookText':'reader.currentChapter',{bookId:args.bookId});
    const chapters=scope==='book'?book.chapters:[{title:book.chapter||book.title,text:book.text}];
    if(!Array.isArray(chapters)||!chapters.some(chapter=>typeof chapter.text==='string'&&chapter.text.trim()))throw Error('No source text found');
    let id=args.notebookId?notebookId(args.notebookId):null;
    if(!id){const result=await s.rpc(RPC.create,[args.title||book.title,null,null,[2],[1,null,null,null,null,null,null,null,null,null,[1]]]);id=notebookId(result?.[2]);}
    const sources=[];await update({notebookId:id,uploadedSources:sources});
    for(const chapter of chapters) {
      if(typeof chapter.text!=='string'||!chapter.text.trim())continue;
      // Keep each source below the text-ingestion budget, preserving characters.
      const pieces=Array.from(chapter.text);
      for(let start=0;start<pieces.length;start+=150000){
        const text=pieces.slice(start,start+150000).join('');
        const title=String(chapter.title||book.title).slice(0,180)+(pieces.length>150000?` (${1+Math.floor(start/150000)})`:'');
        const data=[null,[title,text],null,2,null,null,null,null,null,null,1];
        const result=await s.rpc(RPC.add,[[data],id,[2],[1,null,null,null,null,null,null,null,null,null,[1]]],id);
        const sourceId=result?.[0]?.[0]?.[0]?.[0];
        if(typeof sourceId!=='string')throw Error('Source upload was not confirmed');
        sources.push({sourceId,title});await update({uploadedSources:sources});
      }
    }
    return {notebookId:id,title:book.title,uploadedSources:sources,processingMayContinue:true};
    });
  }
  const id=notebookId(args.notebookId);
  if(name==='ask') {
    const sources=sourceIds(await s.rpc(RPC.get,[id,null,[2],null,0],id));
    if(!sources.length)throw Error('Notebook has no ready sources. Wait for processing or upload a chapter.');
    return s.ask(id,required(args.question,'question',10000),sources);
  }
  if(name==='audio')return once(api,s,args,async()=>{
    const sources=sourceIds(await s.rpc(RPC.get,[id,null,[2],null,0],id));
    if(!sources.length)throw Error('No notebook sources found');
    const language=args.language||'es';
    if(!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(language))throw Error('Invalid language code');
    const focus=String(args.focus||'').slice(0,5000);
    const options=[null,[focus,2,null,sources.map(id=>[id]),language,null,1]];
    const result=await s.rpc(RPC.audio,[[2],id,[null,null,1,sources.map(id=>[[id]]),null,null,options]],id);
    const artifactId=result?.[0]?.[0];
    if(typeof artifactId!=='string')throw Error('Audio creation was not confirmed');
    return {notebookId:id,artifactId,status:'submitted',message:'Use status later; do not create another audio overview while this one is pending.'};
  });
  if(name==='status')return {notebookId:id,artifacts:await statuses(s,id)};
  if(name==='download') {
    const artifact=(await statuses(s,id)).find(row=>row.artifactId===args.artifactId);
    if(!artifact||artifact.status!=='completed'||!artifact.audioUrl)throw Error('Audio is not ready');
    const file=await api.call('files.download',{url:artifact.audioUrl,filename:'NotebookLM-audio.m4a'});
    return {...file,message:'Saved on the phone. Open Settings → AI → Extensions → NotebookLM → Downloaded audio.'};
  }
  throw Error('Unknown NotebookLM tool');
}
module.exports={invoke,parseRpc,parseAnswer,sourceIds,audioUrl};
