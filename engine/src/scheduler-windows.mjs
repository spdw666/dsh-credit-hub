// Wall-clock windows are expanded to real instants. Repeated DST minutes remain
// distinct, and absent DST minutes cannot create an invalid UTC appointment.
const tables=new Map();
export function parseWindowTime(value) {
  if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new RangeError('Window time must be HH:mm (00:00..23:59)');
  return Number(value.slice(0,2))*60+Number(value.slice(3));
}
export function wallDay(now,timezone='Asia/Shanghai') {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function minutesForDay(day,timezone) {
  const key=timezone+'|'+day;if(tables.has(key))return tables.get(key);
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),anchor=Date.parse(day+'T00:00:00Z'),rows=[];
  for(let at=anchor-16*3600000;at<anchor+40*3600000;at+=60000){const p=Object.fromEntries(fmt.formatToParts(at).map(p=>[p.type,p.value]));if(`${p.year}-${p.month}-${p.day}`===day)rows.push({at,minute:Number(p.hour)*60+Number(p.minute)});}
  if(!rows.length)throw new RangeError('No real instants in scheduler local day');
  tables.set(key,rows);if(tables.size>20)tables.delete(tables.keys().next().value);return rows;
}
export function windowPlan(day,schedule,platform,random=()=>Math.random()) {
  const timezone=schedule.timezone??'Asia/Shanghai',rows=minutesForDay(day,timezone),explicit=schedule.windows?.[platform]??schedule.windows?.default;
  const unit=Math.min(1-Number.EPSILON,Math.max(0,Number(random())||0));
  if(!explicit){const minute=(schedule.hour??10)*60+(schedule.minute??0);const first=rows.find(r=>r.minute===minute)??rows.find(r=>r.minute>minute)??rows.at(-1);const jitterSeconds=Math.floor(unit*((schedule.jitterSeconds??0)+1));return {day,at:first.at+jitterSeconds*1000,windowStart:first.at,windowEnd:first.at+Math.max(1,schedule.jitterSeconds??0)*1000,window:{start:`${String(schedule.hour??10).padStart(2,'0')}:${String(schedule.minute??0).padStart(2,'0')}`,end:null,legacy:true},jitterSeconds,dstAdjusted:first.minute!==minute};}
  const start=parseWindowTime(explicit.start),end=parseWindowTime(explicit.end);if(start===end)throw new RangeError('Scheduler window must have a nonzero duration');
  // For an overnight window, both portions belong to their actual local claim
  // day. A persisted daily attempt prevents a second claim in its evening half.
  let matching=rows.filter(r=>start<end?r.minute>=start&&r.minute<end:r.minute>=start||r.minute<end),dstAdjusted=false;
  if(!matching.length){const first=rows.find(r=>r.minute>=start)??rows.at(-1);matching=[first];dstAdjusted=true;}
  const segments=[];for(const row of matching){const last=segments.at(-1);if(last&&last.end===row.at)last.end+=60000;else segments.push({start:row.at,end:row.at+60000});}
  const duration=segments.reduce((n,s)=>n+s.end-s.start,0);let offset=Math.floor(unit*duration),at=segments[0].start;
  for(const s of segments){if(offset<s.end-s.start){at=s.start+offset;break;}offset-=s.end-s.start;}
  return {day,at,windowStart:segments[0].start,windowEnd:segments.at(-1).end,segments,window:{start:explicit.start,end:explicit.end,overnight:start>end},jitterSeconds:Math.floor((at-segments[0].start)/1000),dstAdjusted};
}
