import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCreditHubAdapter,providerId} from '../plugin/provider.mjs';

const model={id:'route-SAMPLE',name:'SAMPLE model',contextWindow:32768,maxTokens:4096,capabilities:{tools:true}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const options=signal=>({provider:providerId,model:model.id,messages:[{role:'user',content:[{type:'text',text:'SAMPLE request'}]}],maxTokens:17,...signal?{signal}:{}});
const collect=stream=>Array.fromAsync(stream);
async function sampleWorker(t,tag,{catalog,chat}={}){
  const calls={catalog:0,chat:[],auth:[]},key='SAMPLE_KEY_'+tag;
  const server=createServer(async(req,res)=>{
    try{
      calls.auth.push(req.headers.authorization);
      if(req.headers.authorization!=='Bearer '+key){res.writeHead(401);res.end('{}');return}
      if(req.url==='/admin/models'){
        calls.catalog++;
        const data=await catalog?.(calls.catalog)??[{...model,name:'SAMPLE '+tag}];
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data}));return;
      }
      if(req.url==='/v1/chat/completions'){
        let data='';for await(const chunk of req)data+=chunk;
        const body=JSON.parse(data);calls.chat.push(body);
        if(chat){await chat(req,res,body);return}
        res.writeHead(200,{'content-type':'text/event-stream'});
        const chunk={id:'SAMPLE-response-'+tag,object:'chat.completion.chunk',created:1,model:model.id};
        res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{role:'assistant',content:'SAMPLE '+tag},finish_reason:null}]})+'\n\n');
        res.write('data: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\n');
        res.end('data: [DONE]\n\n');return;
      }
      res.writeHead(404);res.end('{}');
    }catch{if(!res.headersSent)res.writeHead(500);res.end('{}')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
  return {baseUrl:'http://127.0.0.1:'+server.address().port,key,adminKey:key,calls};
}
function hubFixture(worker,{events=true}={}){
  const listeners=new Set(),waiters=new Set();
  let state='ready';
  const hub={runtime:{...worker,generation:1},status(){return {status:state,generation:this.runtime.generation}},
    async waitUntilReady({signal}={}){
      signal?.throwIfAborted();
      if(state==='ready')return {...this.runtime};
      const gate=deferred();waiters.add(gate);
      const abort=()=>gate.reject(signal.reason??new DOMException('aborted','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});
      try{return await gate.promise}finally{waiters.delete(gate);signal?.removeEventListener('abort',abort)}
    },
    async request(input){
      assert.deepEqual(input,{method:'GET',path:'/admin/models'});
      const runtime={...this.runtime};
      const response=await fetch(runtime.baseUrl+input.path,{headers:{authorization:'Bearer '+runtime.adminKey}});
      return {status:response.status,body:await response.json()};
    },
    recover(){state='recovering';this.runtime.baseUrl='';this.runtime.key='';this.runtime.adminKey=''},
    replace(next){state='ready';this.runtime={...next,generation:this.runtime.generation+1};for(const waiter of waiters)waiter.resolve({...this.runtime});for(const listener of listeners)listener({...this.runtime})},
    listenerCount:()=>listeners.size};
  if(events)hub.onReady=listener=>{listeners.add(listener);return ()=>listeners.delete(listener)};
  return hub;
}

// These are real SDK -> real loopback OpenAI wire requests, never real models.
test('known-model prepared calls refresh endpoint, frozen key, model metadata and policy on a new generation',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B',{catalog:()=>[{...model,contextWindow:1000000,maxTokens:64000,modelRelay:{deliveryMode:'verified_request_buffer',requestTimeoutMs:600000}}]});
  const hub=hubFixture(a),native=createCreditHubAdapter({hub,models:[model],minimumRefreshMs:3600000});t.after(native.dispose);
  const first=await native.adapter.prepareCall(providerId,model.id);await collect(first.stream(options()));
  assert.equal(a.calls.catalog,1);assert.equal(a.calls.chat.length,1);
  hub.replace({...b,maxOutputTokens:12345});
  const second=await native.adapter.prepareCall(providerId,model.id);await collect(second.stream(options()));
  assert.equal(second.model.context.contextWindow,1000000);assert.equal(second.model.defaultMaxTokens,12345);
  assert.equal(native.adapter.config.profiles().get(providerId).streamIdleTimeoutMs,610000);
  assert.equal(b.calls.catalog,1);assert.equal(b.calls.chat.length,1);assert.equal(a.calls.chat.length,1);
  assert.equal(b.calls.chat[0].model,model.id);assert.equal(b.calls.chat[0].max_completion_tokens??b.calls.chat[0].max_tokens,17);
  assert.ok(a.calls.auth.every(value=>value==='Bearer '+a.key));assert.ok(b.calls.auth.every(value=>value==='Bearer '+b.key));
});

test('an already prepared old-generation call fails with typed 503 before either worker receives generation',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B'),hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);
  const prepared=await native.adapter.prepareCall(providerId,model.id);hub.replace(b);
  await assert.rejects(collect(prepared.stream(options())),error=>error.code==='hub_call_stale'&&error.status===503&&error.beforeUpstream===true);
  assert.equal(a.calls.chat.length,0);assert.equal(b.calls.chat.length,0);
  const fresh=await native.adapter.prepareCall(providerId,model.id);await collect(fresh.stream(options()));assert.equal(b.calls.chat.length,1);
});

test('direct stream path on hosts without ready events still reconnects known models and ignores old throttle',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B'),hub=hubFixture(a,{events:false}),native=createCreditHubAdapter({hub,models:[model],minimumRefreshMs:3600000});t.after(native.dispose);
  await collect(native.adapter.stream(options()));hub.replace(b);await collect(native.adapter.stream(options()));
  assert.equal(a.calls.catalog,1);assert.equal(b.calls.catalog,1);assert.equal(a.calls.chat.length,1);assert.equal(b.calls.chat.length,1);
});

test('a late old-generation catalog response never overwrites the newly ready catalog',async t=>{
  const entered=deferred(),release=deferred();
  const a=await sampleWorker(t,'A',{catalog:async()=>{entered.resolve();await release.promise;return [{...model,name:'SAMPLE stale A'}]}}),b=await sampleWorker(t,'B');
  const hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);t.after(()=>release.resolve());
  const stale=native.refresh({force:true});const rejection=assert.rejects(stale,error=>error.code==='hub_generation_changed'&&error.status===503);
  await entered.promise;hub.replace(b);await native.refresh({force:true});assert.equal(native.models()[0].name,'SAMPLE B');
  release.resolve();await rejection;assert.equal(native.models()[0].name,'SAMPLE B');assert.equal(b.calls.catalog,1);
});

test('parallel initial calls single-flight the model refresh and never duplicate caller generations',async t=>{
  const a=await sampleWorker(t,'A'),hub=hubFixture(a),native=createCreditHubAdapter({hub,models:[model]});t.after(native.dispose);
  const calls=await Promise.all(Array.from({length:6},()=>native.adapter.prepareCall(providerId,model.id)));
  await Promise.all(calls.map(call=>collect(call.stream(options()))));
  assert.equal(a.calls.catalog,1);assert.equal(a.calls.chat.length,6);
});

test('abort during recovery rejects prepare and direct stream without touching either generation endpoint',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B'),hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);
  hub.recover();const controller=new AbortController(),reason=new DOMException('SAMPLE cancelled','AbortError');
  const pending=native.adapter.prepareCall(providerId,model.id,controller.signal),stream=collect(native.adapter.stream(options(controller.signal)));
  const preparing=assert.rejects(pending,error=>error===reason),streaming=assert.rejects(stream,error=>error===reason);
  controller.abort(reason);await Promise.all([preparing,streaming]);
  assert.equal(a.calls.catalog,0);assert.equal(a.calls.chat.length,0);hub.replace(b);
  const call=await native.adapter.prepareCall(providerId,model.id);await collect(call.stream(options()));assert.equal(b.calls.chat.length,1);
});

test('a gateway failure yields one terminal result and never replays the already sent generation after reconnect',async t=>{
  let switchWorker;
  const a=await sampleWorker(t,'A',{chat:async(_req,res)=>{switchWorker();res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'SAMPLE upstream failure',type:'server_error'}}))}}),b=await sampleWorker(t,'B');
  const hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);switchWorker=()=>hub.replace(b);
  const call=await native.adapter.prepareCall(providerId,model.id),chunks=await collect(call.stream(options()));
  assert.equal(a.calls.chat.length,1);assert.equal(b.calls.chat.length,0);assert.equal(chunks.filter(chunk=>chunk.type==='finish').length,1);
  assert.ok(chunks.find(chunk=>chunk.type==='finish').reason.failure);
});

test('disposing cancels ready listeners and pending waits, and a later ready event performs no catalog fetch',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B'),hub=hubFixture(a),native=createCreditHubAdapter({hub});
  assert.equal(hub.listenerCount(),1);hub.recover();const pending=native.adapter.prepareCall(providerId,model.id);
  const rejected=assert.rejects(pending,error=>error.code==='hub_provider_disposed'&&error.status===503);native.dispose();native.dispose();await rejected;
  assert.equal(hub.listenerCount(),0);hub.replace(b);await new Promise(resolve=>setImmediate(resolve));assert.equal(b.calls.catalog,0);
  await assert.rejects(native.refresh(),error=>error.code==='hub_provider_disposed');
});

test('an interrupted in-flight SAMPLE stream is not replayed on a replacement worker',async t=>{
  const sent=deferred();
  const a=await sampleWorker(t,'A',{chat:async(_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'SAMPLE',object:'chat.completion.chunk',created:1,model:model.id,choices:[{index:0,delta:{role:'assistant',content:'SAMPLE partial'},finish_reason:null}]})+'\n\n');sent.resolve(res)}}),b=await sampleWorker(t,'B');
  const hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);const controller=new AbortController();
  const call=await native.adapter.prepareCall(providerId,model.id),pending=collect(call.stream(options(controller.signal))),response=await sent.promise;
  hub.replace(b);controller.abort();response.end();const chunks=await pending;
  assert.equal(a.calls.chat.length,1);assert.equal(b.calls.chat.length,0);assert.equal(chunks.filter(chunk=>chunk.type==='finish').length,1);
});

test('published profile snapshots retain their original URL and old keys are never combined with a new endpoint',async t=>{
  const a=await sampleWorker(t,'A'),b=await sampleWorker(t,'B'),hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);
  await native.refresh();const previous=native.adapter.config.profiles().get(providerId),oldRaw=previous.piProvider.getModels()[0];
  assert.equal(oldRaw.baseUrl,a.baseUrl+'/v1');hub.replace(b);await native.refresh();
  const next=native.adapter.config.profiles().get(providerId);assert.notEqual(previous,next);
  assert.equal(previous.piProvider.getModels()[0].baseUrl,a.baseUrl+'/v1');assert.equal(next.piProvider.getModels()[0].baseUrl,b.baseUrl+'/v1');
  await assert.rejects(native.adapter.config.resolveApiKey(providerId,previous),error=>error.code==='hub_generation_changed'&&error.status===503);
  assert.equal(await native.adapter.config.resolveApiKey(providerId,next),b.key);
});

test('aborting one catalog waiter does not cancel another waiter or issue a second catalog or generation',async t=>{
  const entered=deferred(),release=deferred(),a=await sampleWorker(t,'A',{catalog:async()=>{entered.resolve();await release.promise;return [model]}});
  const hub=hubFixture(a),native=createCreditHubAdapter({hub});t.after(native.dispose);t.after(()=>release.resolve());
  const controller=new AbortController(),cancelled=native.adapter.prepareCall(providerId,model.id,controller.signal);
  const rejected=assert.rejects(cancelled,error=>error.name==='AbortError'),survivor=native.adapter.prepareCall(providerId,model.id);
  await entered.promise;controller.abort();await rejected;release.resolve();const prepared=await survivor;
  await collect(prepared.stream(options()));assert.equal(a.calls.catalog,1);assert.equal(a.calls.chat.length,1);
});

test('typed readiness failure reaches both new-call interfaces without catalog, generation, or implicit replay',async t=>{
  const a=await sampleWorker(t,'A'),hub=hubFixture(a),failure=Object.assign(new Error('SAMPLE recovering'),{code:'hub_not_ready',status:503});
  hub.waitUntilReady=async()=>{throw failure};const native=createCreditHubAdapter({hub});t.after(native.dispose);
  await assert.rejects(native.adapter.prepareCall(providerId,model.id),error=>error===failure);
  await assert.rejects(collect(native.adapter.stream(options())),error=>error===failure);
  assert.equal(a.calls.catalog,0);assert.equal(a.calls.chat.length,0);
});
