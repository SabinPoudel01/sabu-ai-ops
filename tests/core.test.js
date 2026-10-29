import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedMonitorURL, classifyProviderFailure, candidateProviders, xmlSafe, normalizeAction} from '../src/core.js';

test('blocks internal and unsafe monitor URL shapes',()=>{
  for(const u of ['http://example.com','https://localhost','https://127.0.0.1','https://10.0.0.1','https://169.254.169.254/latest','https://site.internal','https://site.local','https://user:pass@site.com','https://site.com:8443','javascript:alert(1)','https://[::1]']) assert.equal(allowedMonitorURL(u),false,u);
  assert.equal(allowedMonitorURL('https://example.com/health'),true);
  assert.equal(allowedMonitorURL('https://example.com:443/status'),true);
});
test('provider routing enforces unpaid verified free tier and priorities',()=>{
 const base={kind:'ai',enabled:1,state:'ready',free_verified:1,quota_units:10,used_units:0,created_at:'2026-01-01'};
 const providers=[{...base,id:'paid',plan:'paid',priority:1},{...base,id:'freeB',plan:'free',priority:20},{...base,id:'freeA',plan:'trial',priority:5},{...base,id:'over',plan:'free',priority:3,used_units:10},{...base,id:'unverified',plan:'free',priority:2,free_verified:0},{...base,id:'disabled',plan:'free',priority:0,enabled:0}];
 assert.deepEqual(candidateProviders(providers,'ai',true).map(p=>p.id),['freeA','freeB']);
 assert.deepEqual(candidateProviders(providers,'call',true),[]);
});
test('provider errors classify quota, auth, cooldown',()=>{
 assert.equal(classifyProviderFailure(402),'exhausted');
 assert.equal(classifyProviderFailure(429,'quota exhausted'),'exhausted');
 assert.equal(classifyProviderFailure(429,'rate limit'),'cooldown');
 assert.equal(classifyProviderFailure(401),'invalid');
 assert.equal(classifyProviderFailure(503),'temporary');
});
test('text escaping and action whitelist',()=>{
 assert.equal(xmlSafe('<&"'), '&lt;&amp;&quot;');
 assert.equal(normalizeAction('retry_build'),'retry_build');
 assert.equal(normalizeAction('delete_all'),null);
});
