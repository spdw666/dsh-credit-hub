import {dayIn,errorView} from './util.mjs';
export class ClaimService {
  constructor(config,credentials,platforms,ledger){Object.assign(this,{config,credentials,platforms,ledger});}
  async run(accountId,taskId='daily-checkin') {
    const day=dayIn(new Date(),this.config.value.scheduler.timezone);let account=this.config.value.accounts.find(a=>a.id===accountId);
    const base={day,platform:account?.platform??'unknown',accountId,task:taskId};let key, reserved=false, wrote=false,priorUncertain=false;
    const finish=(status,result={})=>{const full={...base,status,...result};if(reserved)this.ledger.finish(key,status,result);this.ledger.record(full);return full;};
    try {
      if(!account||account.enabled===false)return finish('skipped',{reason:'account_disabled'});
      const task=account.tasks?.find(t=>t.id===taskId);if(!task?.enabled)return finish('skipped',{reason:'task_disabled'});
      const c=await this.credentials.resolve(accountId);
      // Qoder's verified daily campaign changes at 10:00 CST, not midnight.
      // Read its current window before reserving; retries in that window stay idempotent.
      let before;
      if(account.platform==='qoder'){
        before=await this.platforms.status(accountId,taskId);
        if(!before.known)return finish('error',{reason:'unknown_server_state',beforeSubmission:true,retryable:true});
        if(before.campaignWindowId)base.campaignWindowId=String(before.day??day)+':'+String(before.campaignWindowId);
        if(Number.isFinite(Date.parse(before.nextClaimAt)))base.nextClaimAt=before.nextClaimAt;
      }
      key=this.ledger.claimKey(account.platform,c.principalHash,base.campaignWindowId?'campaign:'+base.campaignWindowId:day,taskId,c.identity?.deviceId??'');
      const datedObservation=['loomy','raccoon'].includes(account.platform)&&['daily-quota','daily-checkin'].includes(taskId);
      const reservation=this.ledger.reserve(key,Date.now(),datedObservation?{observationDay:day}:{});reserved=reservation.acquired;priorUncertain=reservation.uncertain===true;
      const observed=result=>finish('observed',{...result,...(datedObservation?{observationSchema:1,observationVerifiedDay:day}:{})});
      if(!reserved)return finish(reservation.status==='observed'?'observed':reservation.status==='rejected'?'rejected':reservation.done?'already':'busy',{...(reservation.result??{}),originalReason:reservation.result?.reason,reason:reservation.done?'local_idempotency':'another_worker'});
      before??=await this.platforms.status(accountId,taskId);
      if(!before.known)return finish(priorUncertain?'uncertain':'error',{reason:'unknown_server_state',beforeSubmission:!priorUncertain,retryable:!priorUncertain});
      if(before.observed)return observed({reason:before.reason,details:before.details});
      if(before.claimed)return finish('already',{reason:before.reason??'server_already_claimed',credits:before.credits,...(before.details?{details:before.details}:{})});
      if(!before.active)return finish(priorUncertain?'uncertain':'not_available',{reason:before.reason??'activity_inactive',beforeSubmission:!priorUncertain,...(before.nextClaimAt?{nextClaimAt:before.nextClaimAt}:{} )});
      if(before.deviceOccupied)return finish(priorUncertain?'uncertain':'device_occupied',{reason:'device_daily_limit'});
      // A crash/timeout after submission must not resubmit merely because the local row is stale.
      const confirmOnly=reservation.uncertain&&account.platform==='codearts'&&taskId==='daily-checkin'&&before.known===true&&before.pendingConfirmation===true;
      if(reservation.uncertain&&!confirmOnly)return finish('uncertain',{reason:'previous_submission_unconfirmed',serverState:'not_claimed'});
      wrote=true;const claim=await this.platforms.claim(accountId,taskId,confirmOnly?{confirmOnly:true}:{});
      if(claim.submitted===false&&!priorUncertain)wrote=false;
      const after=await this.platforms.status(accountId,taskId);
      // Official automatic-entitlement refresh is not a paid/active claim. Both
      // the submission adapter and a fresh known server recheck must agree.
      if(claim.observed===true&&claim.claimed!==true&&after.known===true&&after.observed===true&&after.claimed!==true)return observed({reason:after.reason??claim.reason??'server_auto_daily_quota',claimed:false,officialRefreshConfirmed:true,...(after.details??claim.details?{details:after.details??claim.details}:{})});
      if(!after.claimed){const notSubmitted=claim.submitted===false&&!priorUncertain;return finish(notSubmitted?'not_available':'uncertain',{reason:notSubmitted?(claim.reason??'not_claimable'):'claim_response_not_confirmed',beforeSubmission:notSubmitted,retryable:false});}
      if(account.platform==='workbuddy')this.ledger.set('wb-pool-cooldown:'+accountId,{until:0,reason:'checkin_confirmed'});
      return finish('success',{credits:claim.credit??after.credits,serverConfirmed:true,...(claim.unit?{unit:claim.unit}:{}),...(claim.planId?{planId:claim.planId,details:claim.details}: {})});
    }catch(e){
      const beforeSubmission=!priorUncertain&&(!wrote||e.beforeSubmission===true);
      // Retry only a known pre-submission failure. A timeout after a claim was
      // sent remains uncertain and is never converted into a second POST.
      const loginRequired=e.loginRequired===true||e.status===401;
      const retryable=beforeSubmission&&!e.actionRequired&&!e.definitiveRejection&&(loginRequired||e.retryable===true||e.status===429||e.status>=500||/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/.test(e.code??'')||['TimeoutError','TypeError'].includes(e.name));
      return finish(priorUncertain?'uncertain':e.actionRequired||loginRequired?'action_required':e.definitiveRejection?'rejected':beforeSubmission?'error':'uncertain',{reason:e.code??'upstream_error',error:errorView(e),beforeSubmission,retryable,...(e.retryAt?{retryAt:e.retryAt}:{})});
    }
  }
  async all() {
    const accounts=this.config.value.accounts.filter(a=>a.enabled!==false),rows=new Array(accounts.length);let next=0;
    // Accounts run concurrently (bounded to two); each account's tasks stay sequential.
    const worker=async()=>{while(next<accounts.length){const i=next++,a=accounts[i];rows[i]=[];for(const t of a.tasks??[])if(t.enabled)rows[i].push(await this.run(a.id,t.id));}};
    await Promise.all(Array.from({length:Math.min(2,accounts.length)},worker));return rows.flat();
  }
}
