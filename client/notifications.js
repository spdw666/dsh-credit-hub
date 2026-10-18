/** Global DSH-local event sink: works while another DSH panel is selected. */
export function installNativeNotifications({api,onOpen,document:doc=globalThis.document,setInterval:repeat=setInterval,clearInterval:cancel=clearInterval}){
 if(!doc?.body)return ()=>{};
 let closed=false,flight=false;const seen=new Set(),timeouts=new Set(),center=doc.createElement('aside');
 center.className='credit-hub__notification-center';center.setAttribute('aria-label','积分中枢通知');doc.body.append(center);
 const visible=()=>doc.hidden!==true&&doc.visibilityState!=='hidden'&&(typeof doc.hasFocus!=='function'||doc.hasFocus());
 async function poll(){if(closed||flight||!visible())return;flight=true;try{const response=await api.request({method:'GET',path:'/hub/events/pending'});if(closed||!visible())return;const acknowledgements=[];
 for(const item of response.body?.items??[]){if(seen.has(item.deliveryId)){acknowledgements.push(item.deliveryId);continue;}if(center.children.length>=5)break;
 const event=item.event??{},card=doc.createElement('section'),title=doc.createElement('strong'),copy=doc.createElement('p'),open=doc.createElement('button'),close=doc.createElement('button');
 card.className='credit-hub__notification';card.setAttribute('role',event.severity==='error'?'alert':'status');title.textContent=event.title||'积分中枢事件';
 const data=event.data??{};const detail=event.type==='update.available'?`版本 ${data.currentVersion||'当前'} → ${data.latestVersion||'新版本'}，请打开插件市场检查更新。`:event.type==='credential.expiring'?`凭据将在 ${Number.isFinite(data.remainingDays)?data.remainingDays.toFixed(1):'若干'} 天内过期。`:event.type==='balance.low'?`余额 ${data.value??'—'} ${data.unit||''} 已跌破设置阈值。`:event.type==='request.failure_streak'?`连续 ${data.streak||3} 次请求失败，请查看账户与上游状态。`:event.type==='relay.triggered'?'当前请求已转入接力候选。':'签到失败，请在今日未签到列表核对并手动补签。';
 copy.textContent=(event.accountLabel?event.accountLabel+' · ':'')+detail;open.type='button';open.textContent='打开积分中枢';open.onclick=()=>onOpen?.();close.type='button';close.textContent='关闭';close.onclick=()=>card.remove();card.append(title,copy,open,close);center.append(card);seen.add(item.deliveryId);acknowledgements.push(item.deliveryId);
 const expiry=globalThis.setTimeout?.(()=>{card.remove();timeouts.delete(expiry);},15000);if(expiry)timeouts.add(expiry);
 }
 if(acknowledgements.length&&!closed)await api.request({method:'POST',path:'/hub/events/ack',body:{deliveryIds:acknowledgements}});
 }catch{/* Connection owns reconnection; retain unacknowledged durable inbox. */}finally{flight=false;}}
 const resume=()=>{if(visible())void poll();};doc.addEventListener?.('visibilitychange',resume);doc.defaultView?.addEventListener?.('focus',resume);
 const timer=repeat(()=>void poll(),3000);timer?.unref?.();
 return ()=>{closed=true;cancel(timer);doc.removeEventListener?.('visibilitychange',resume);doc.defaultView?.removeEventListener?.('focus',resume);for(const timer of timeouts)globalThis.clearTimeout?.(timer);center.remove();};
}
