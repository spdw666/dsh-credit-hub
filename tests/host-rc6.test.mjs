import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LAST_AUDITED_DSH_VERSION,buildDshCompatibilityRange} from '../plugin/compatibility.mjs';

const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('rc.6 host peers and audited tag matrix agree without admitting unaudited future prereleases',async()=>{
  const p=await json('package.json'),tags=await json('test-fixtures/dsh-tags.json'),m=await json('test-fixtures/compatibility-matrix.json');
  assert.equal(LAST_AUDITED_DSH_VERSION,'0.2.2-rc.3');
  assert.equal(m.lastTag,'dsh-v'+LAST_AUDITED_DSH_VERSION);
  assert.equal(m.exactDshRange,buildDshCompatibilityRange(tags.map(t=>t.name)));
  const sdkPeers=Object.entries(p.peerDependencies).filter(([name])=>name.startsWith('@deepseek-ai/dsh-'));
  assert.equal(sdkPeers.length,3);
  // A peer range may only name releases this matrix actually audited.
  const auditedVersions=new Set(m.releases.map(r=>r.version));
  for(const [name,range]of sdkPeers){
    assert.equal(range,m.exactDshRange,name);
    for(const admitted of range.split(' || '))assert.ok(auditedVersions.has(admitted),`${name} admits unaudited ${admitted}`);
    assert.ok(!range.includes('*'));
  }
  const audited=m.releases.find(r=>r.version===LAST_AUDITED_DSH_VERSION);
  assert.equal(tags[0].sha,audited.sha);assert.equal(audited.sha,'38a6a5c965aa99ab525161efb7cc5cf1fe62fced');
  assert.equal(audited.verification.sourceAudit,true);assert.equal(audited.verification.officialModuleFixture,true);
  assert.equal(audited.verification.fullHistoricalHostRuntime,false);
  for(const feature of ['registerAdapter','registerConfigurableProviders','registerModelDiscovery','streamWithSnapshot','prepareCall','typertRemote','rpcNamedArgs','settingsSection','sidebarPanelList'])assert.equal(audited.features[feature],true,feature);
  assert.equal(audited.moduleFixture.streamFixture.outputBudget,64000);assert.equal(audited.moduleFixture.upstreamNetwork,false);
});
test('development SDK pins each host to its own vendored versions and CI keeps an independent job per audited host line',async()=>{
  const sdk=await readFile(new URL('../scripts/install-dev-sdk.mjs',import.meta.url),'utf8'),ci=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.match(sdk,/CREDIT_HUB_TEST_DSH_VERSION\?\?'0\.2\.2-rc\.3'/);
  // The 0.2.2 line moved cordis, schemastery, loader and pi-ai; reusing the older mix would test nothing.
  assert.match(sdk,/'0\.2\.2-rc\.2':\{cordis:'4\.1\.0',schemastery:'3\.19\.0',loader:'1\.1\.0',piAi:'1\.3\.0'\}/);
  assert.match(sdk,/'0\.2\.2-rc\.3':\{cordis:'4\.1\.0',schemastery:'3\.19\.0',loader:'1\.1\.0',piAi:'1\.3\.0'\}/);
  assert.match(sdk,/'0\.2\.2-rc\.1':\{cordis:'4\.1\.0',schemastery:'3\.19\.0',loader:'1\.1\.0',piAi:'1\.3\.0'\}/);
  assert.match(sdk,/'0\.2\.1-rc\.5':legacy/);
  assert.match(sdk,/if\(!\(hostVersion in HOST_SDK\)\)/);
  for(const host of ['0.2.1-rc.2','0.2.1-rc.3','0.2.1-rc.5','0.2.2-rc.1','0.2.2-rc.2','0.2.2-rc.3'])assert.match(ci,new RegExp(`dsh-sdk: ${host.replace(/\./g,'\\.')}`),host);
  assert.match(ci,/CREDIT_HUB_TEST_DSH_VERSION: \$\{\{ matrix\.dsh-sdk \}\}/);
  // The 0.2.2 line declares engines.node >=24.9.0 and cannot run on the Node 22 jobs.
  // GitHub checks this file out with CRLF on its Windows runners, so never anchor on a bare \n.
  assert.match(ci,/dsh-sdk: 0\.2\.2-rc\.3\r?\n\s+node: '24\.21\.0'/);
  assert.match(ci,/dsh-sdk: 0\.2\.2-rc\.2\r?\n\s+node: '24\.21\.0'/);
  assert.match(ci,/dsh-sdk: 0\.2\.2-rc\.1\r?\n\s+node: '24\.21\.0'/);
  assert.equal((ci.match(/node: '22\.23\.3'/g)??[]).length,3);
  assert.equal((ci.match(/node: '24\.21\.0'/g)??[]).length,3);
});
