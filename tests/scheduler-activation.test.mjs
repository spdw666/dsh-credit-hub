import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulerActivation,shouldStartScheduler} from '../server/scheduler-activation.mjs';
test('new installs and disabled schedules remain idle',()=>{
 assert.equal(shouldStartScheduler({}, {enabled:false}),false);
 assert.equal(shouldStartScheduler({allowScheduler:true},{enabled:false,consentVersion:1}),false);
 assert.equal(shouldStartScheduler({allowScheduler:false},{enabled:true}),false);
});
test('explicit enable persists consent across worker restart without resetting other fields',()=>{
 const settings=schedulerActivation({enabled:false,startup:true,maxConcurrency:2,windows:{lobster:{start:'00:05',end:'00:40'}}},{enabled:true});
 assert.equal(settings.consentVersion,1);assert.equal(settings.maxConcurrency,2);
 assert.equal(shouldStartScheduler({allowScheduler:false},JSON.parse(JSON.stringify(settings))),true);
 assert.equal(shouldStartScheduler({allowScheduler:true},{enabled:true}),true);
 const disabled=schedulerActivation(settings,{enabled:false});assert.equal(shouldStartScheduler({},disabled),false);
});
