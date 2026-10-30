import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LAST_AUDITED_DSH_VERSION,buildDshCompatibilityRange} from '../plugin/compatibility.mjs';

const json=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
test('rc.5 host peers and audited tag matrix agree without admitting unaudited future prereleases',async()=>{
  const p=await json('package.json'),tags=await json('test-fixtures/dsh-tags.json'),m=await json('test-fixtures/compatibility-matrix.json');
  assert.equal(LAST_AUDITED_DSH_VERSION,'0.2.1-rc.5');
  assert.equal(m.lastTag,'dsh-v'+LAST_AUDITED_DSH_VERSION);
  assert.equal(m.exactDshRange,buildDshCompatibilityRange(tags.map(t=>t.name)));
  const sdkPeers=Object.entries(p.peerDependencies).filter(([name])=>name.startsWith('@deepseek-ai/dsh-'));
  assert.equal(sdkPeers.length,3);
  for(const [name,range]of sdkPeers){assert.equal(range,m.exactDshRange,name);assert.ok(!range.includes('rc.6'));assert.ok(!range.includes('*'));}
  const audited=m.releases.find(r=>r.version===LAST_AUDITED_DSH_VERSION);
  assert.equal(tags[0].sha,audited.sha);assert.equal(audited.sha,'b830ec950faba0a46dda564be3e2d854afed94f1');
  assert.equal(audited.verification.sourceAudit,true);assert.equal(audited.verification.officialModuleFixture,true);
  assert.equal(audited.verification.fullHistoricalHostRuntime,false);
  for(const feature of ['registerAdapter','registerConfigurableProviders','registerModelDiscovery','streamWithSnapshot','prepareCall','typertRemote','rpcNamedArgs','settingsSection','sidebarPanelList'])assert.equal(audited.features[feature],true,feature);
  assert.equal(audited.moduleFixture.streamFixture.outputBudget,64000);assert.equal(audited.moduleFixture.upstreamNetwork,false);
});
test('development SDK defaults to rc.5 and CI retains independent rc.2, rc.3 and rc.5 jobs',async()=>{
  const sdk=await readFile(new URL('../scripts/install-dev-sdk.mjs',import.meta.url),'utf8'),ci=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  assert.match(sdk,/CREDIT_HUB_TEST_DSH_VERSION\?\?'0\.2\.1-rc\.5'/);
  assert.match(sdk,/\['0\.2\.1-rc\.2','0\.2\.1-rc\.3','0\.2\.1-rc\.4','0\.2\.1-rc\.5'\]\.includes\(hostVersion\)/);
  assert.match(ci,/dsh-sdk: \[0\.2\.1-rc\.2, 0\.2\.1-rc\.3, 0\.2\.1-rc\.5\]/);
  assert.match(ci,/CREDIT_HUB_TEST_DSH_VERSION: \$\{\{ matrix\.dsh-sdk \}\}/);
});
