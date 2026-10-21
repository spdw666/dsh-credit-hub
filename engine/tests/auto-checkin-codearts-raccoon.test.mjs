import test from 'node:test';
import assert from 'node:assert/strict';
import {codeartsClaim} from '../src/provider-codearts.mjs';
import {raccoonClaim,raccoonStatus} from '../src/provider-raccoon.mjs';

const codearts={accessKey:'SAMPLE_ACCESS',secretKey:'SAMPLE_SECRET',securityToken:'SAMPLE_SECURITY'};
const raccoon={accessToken:'SAMPLE_TOKEN',authKind:'bearer',principal:'SAMPLE'};
const now=Date.parse('2026-10-21T03:00:00Z');
const delivery=state=>Response.json({code:0,data:{items:[{campaignId:1,status:state,
  claimable:state==='ELIGIBLE',benefitAmount:1000,benefitUnit:'CREDIT'}]}});
const json=data=>Response.json({code:0,data});
const bill={biz_type:'daily_grant',points:300,grant_at:'2026-10-21T00:00:00+08:00',expire_at:'2026-10-27T23:59:59+08:00'};

test('automatic CodeArts check-in recovers a committed claim whose response was lost without resubmission',async()=>{
  let state='ELIGIBLE';const posts=[];
  const result=await codeartsClaim(codearts,'daily-checkin',{fetchImpl:async(url,init)=>{
    if(init.method==='GET')return delivery(state);
    const path=new URL(url).pathname;posts.push(path);
    if(path==='/v1/ops/claim'){state='CLAIMED';throw new TypeError('SAMPLE disconnected acknowledgement');}
    state='CONFIRMED';return json({});
  }});
  assert.equal(result.claimed,true);assert.equal(result.confirmed,true);
  assert.equal(result.rechecked,true);assert.equal(result.submissionResponseLost,true);
  assert.deepEqual(posts,['/v1/ops/claim','/v1/ops/confirm']);
});

test('automatic CodeArts check-in accepts only settled delivery after a lost confirm response',async()=>{
  let state='CLAIMED',confirmCalls=0;
  const result=await codeartsClaim(codearts,'daily-checkin',{fetchImpl:async(_url,init)=>{
    if(init.method==='GET')return delivery(state);
    confirmCalls++;state='CONFIRMED';throw new TypeError('SAMPLE disconnected confirm acknowledgement');
  }});
  assert.equal(result.claimed,true);assert.equal(result.confirmed,true);
  assert.equal(result.confirmationResponseLost,true);assert.equal(confirmCalls,1);
});

test('automatic CodeArts check-in reads through eventual delivery without replaying either write',async()=>{
  let state='ELIGIBLE',readsAfterConfirm=0;const posts=[];
  const result=await codeartsClaim(codearts,'daily-checkin',{fetchImpl:async(url,init)=>{
    if(init.method==='GET'){
      if(state==='CONFIRM_SENT'&&++readsAfterConfirm>=2)state='CONFIRMED';
      return delivery(state==='CONFIRM_SENT'?'CLAIMED':state);
    }
    const path=new URL(url).pathname;posts.push(path);
    state=path==='/v1/ops/claim'?'CLAIMED':'CONFIRM_SENT';return json({});
  }});
  assert.equal(result.confirmed,true);assert.equal(readsAfterConfirm,2);
  assert.deepEqual(posts,['/v1/ops/claim','/v1/ops/confirm']);
});

test('automatic CodeArts check-in leaves unresolved submission uncertain rather than sending claim again',async()=>{
  let claimCalls=0,confirmCalls=0;
  await assert.rejects(codeartsClaim(codearts,'daily-checkin',{fetchImpl:async(url,init)=>{
    if(init.method==='GET')return delivery('ELIGIBLE');
    if(new URL(url).pathname==='/v1/ops/claim')claimCalls++;else confirmCalls++;
    throw new TypeError('SAMPLE unresolved submission');
  }}),{code:'codearts_network_error'});
  assert.equal(claimCalls,1);assert.equal(confirmCalls,0);
});

test('automatic Raccoon login benefit goes from missing to dated official receipt, not a positive balance',async()=>{
  let submitted=false,posts=0;
  const fetchImpl=async(url,init)=>{
    if(init.method==='POST'){posts++;submitted=true;return json({granted:false});}
    return json(url.includes('/bills')?{items:submitted?[bill]:[]}:{daily_points:900,available_points:9900});
  };
  const before=await raccoonStatus(raccoon,'daily-quota',{now,fetchImpl});
  assert.equal(before.active,true);assert.equal(before.observed,false);assert.equal(before.claimable,true);
  const result=await raccoonClaim(raccoon,'daily-quota',{now,fetchImpl});
  assert.equal(result.observed,true);assert.equal(result.claimed,false);assert.equal(result.credit,0);
  assert.equal(result.details.receipt.day,'2026-10-21');assert.equal(result.rechecked,true);
  assert.equal(result.details.receipt.loginExtended,true);assert.equal(posts,1);
  const again=await raccoonClaim(raccoon,'daily-quota',{now,fetchImpl});
  assert.equal(again.submitted,false);assert.equal(posts,1);
});

test('automatic Raccoon login benefit recovers a committed grant after a lost response without another POST',async()=>{
  let submitted=false,posts=0;
  const result=await raccoonClaim(raccoon,'daily-quota',{now,fetchImpl:async(url,init)=>{
    if(init.method==='POST'){posts++;submitted=true;throw new TypeError('SAMPLE acknowledgement lost');}
    return json(url.includes('/bills')?{items:submitted?[bill]:[]}:{daily_points:900});
  }});
  assert.equal(result.observed,true);assert.equal(result.claimed,false);
  assert.equal(result.submissionResponseLost,true);assert.equal(posts,1);
});

test('automatic Raccoon login benefit tolerates delayed official bills without replaying grant',async()=>{
  let submitted=false,posts=0,readsAfterPost=0;
  const result=await raccoonClaim(raccoon,'daily-quota',{now,fetchImpl:async(url,init)=>{
    if(init.method==='POST'){posts++;submitted=true;return json({granted:true,popup:{points:3000}});}
    if(url.includes('/bills'))return json({items:submitted&&++readsAfterPost>=2?[bill]:[]});
    return json({daily_points:900});
  }});
  assert.equal(result.observed,true);assert.equal(result.desktopRewardGranted,true);
  assert.equal(result.credit,0);assert.equal(posts,1);assert.equal(readsAfterPost,2);
});

test('automatic Raccoon login benefit never accepts POST acknowledgement without same-day official receipt',async()=>{
  let posts=0;
  await assert.rejects(raccoonClaim(raccoon,'daily-quota',{now,fetchImpl:async(url,init)=>{
    if(init.method==='POST'){posts++;return json({granted:true,popup:{points:3000}});}
    return json(url.includes('/bills')?{items:[{...bill,grant_at:'2026-10-20T00:00:00+08:00'}]}:{daily_points:900});
  }}),{code:'raccoon_daily_unconfirmed'});
  assert.equal(posts,1);
});
