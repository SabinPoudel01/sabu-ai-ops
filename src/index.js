import { safeJson, iso, clamp, allowedMonitorURL, classifyProviderFailure, candidateProviders, xmlSafe, normalizeAction } from './core.js';

const te = new TextEncoder();
const j = (data, status=200, headers={}) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const err = (code, status=400) => j({error:code}, status);
const newId = () => crypto.randomUUID();
const bytesToB64 = a => btoa(String.fromCharCode(...new Uint8Array(a)));
const b64ToBytes = s => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const hex = a => Array.from(new Uint8Array(a), x=>x.toString(16).padStart(2,'0')).join('');
const constantEquals = (a,b) => { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0; };
async function digest(s) { return hex(await crypto.subtle.digest('SHA-256',te.encode(s))); }
async function passHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64ToBytes(salt),iterations:120000,hash:'SHA-256'},key,256));
}
async function cryptKey(env) {
  if (!env.ENCRYPTION_KEY) throw Error('MISSING_ENCRYPTION_KEY');
  const bytes=b64ToBytes(env.ENCRYPTION_KEY);
  if (bytes.length!==32) throw Error('INVALID_ENCRYPTION_KEY');
  return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function seal(obj,env) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptKey(env),te.encode(JSON.stringify(obj)));
  return bytesToB64(iv)+'.'+bytesToB64(payload);
}
async function unseal(s,env) {
  const [iv,b]=s.split('.');
  const payload=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(iv)},await cryptKey(env),b64ToBytes(b));
  return JSON.parse(new TextDecoder().decode(payload));
}
async function setting(env,key,defaultValue='') {
  const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return row?.value ?? defaultValue;
}
async function audit(env,actor,action,detail='') {
  await env.DB.prepare('INSERT INTO audit(id,actor,action,detail,created_at) VALUES(?,?,?,?,?)').bind(newId(),actor,action,String(detail).slice(0,500),iso()).run();
}
async function readBody(req) {
  if(Number(req.headers.get('content-length')||0)>20000) throw Error('BODY_TOO_LARGE');
  const txt=await req.text();
  if(txt.length>20000) throw Error('BODY_TOO_LARGE');
  return safeJson(txt, {}) || {};
}
async function currentAdmin(req,env) {
  const m=(req.headers.get('cookie')||'').match(/(?:^|;\s*)sabu_session=([^;]+)/);
  if(!m) return null;
  const tokenHash=await digest(m[1]);
  return await env.DB.prepare('SELECT admins.id, admins.username FROM sessions JOIN admins ON admins.id=sessions.admin_id WHERE sessions.token_hash=? AND sessions.expires_at>?').bind(tokenHash,iso()).first();
}
function requireOrigin(req) {
  const origin=req.headers.get('origin');
  return !!origin && origin === new URL(req.url).origin;
}
async function allProviders(env,kind=null) {
  const query=kind?'SELECT * FROM provider_accounts WHERE kind=?':'SELECT * FROM provider_accounts';
  return (await (kind?env.DB.prepare(query).bind(kind):env.DB.prepare(query)).all()).results||[];
}
function publicProvider(p) {
  const {credentials_cipher,...safe}=p;
  return {...safe,config:safeJson(safe.config_json,{})};
}
async function markProvider(env,pid,state,message) {
  await env.DB.prepare('UPDATE provider_accounts SET state=?,last_error=? WHERE id=?').bind(state,String(message||'').slice(0,200),pid).run();
}
async function consumeProvider(env,p,unit=1) {
  await env.DB.prepare("UPDATE provider_accounts SET used_units=used_units+?,last_used_at=? WHERE id=?").bind(unit,iso(),p.id).run();
  if(p.quota_units!==null && p.used_units+unit>=p.quota_units) await markProvider(env,p.id,'exhausted','Locally configured allowance reached');
}
async function aiText(env,question) {
  const providers=candidateProviders(await allProviders(env,'ai'),'ai',env.ZERO_SPEND==='true').filter(p=>env.ZERO_SPEND!=='true'||p.service==='gemini');
  if(!providers.length) return {answer:'AI account not available. Add an eligible free-tier Gemini account in Providers, or review the incident directly in dashboard.',provider:null,offline:true};
  for(const p of providers) {
    try {
      const credentials=await unseal(p.credentials_cipher,env),cfg=safeJson(p.config_json,{});
      let response,body,answer;
      const timeout=AbortSignal.timeout(13000);
      if(p.service==='gemini') {
        const model=String(cfg.model||'gemini-2.5-flash-lite');
        response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
          method:'POST',headers:{'content-type':'application/json','x-goog-api-key':credentials.apiKey},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:question.slice(0,6000)}]}],generationConfig:{maxOutputTokens:250,temperature:0.2}}),signal:timeout});
        body=await response.json();
        answer=body.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join(' ').trim();
      } else if(p.service==='openai') {
        response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credentials.apiKey},
          body:JSON.stringify({model:String(cfg.model||'gpt-4.1-mini'),input:question.slice(0,6000),max_output_tokens:250}),signal:timeout});
        body=await response.json();
        answer=body.output_text || body.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join(' ').trim();
      } else continue;
      if(!response.ok) {
        const state=classifyProviderFailure(response.status,JSON.stringify(body).slice(0,500));
        if(state==='exhausted'||state==='invalid') await markProvider(env,p.id,state,'Provider rejected request: '+response.status);
        if(state==='cooldown') await markProvider(env,p.id,state,'Rate limited: re-enable after quota resets');
        continue;
      }
      if(!answer) throw Error('EMPTY_PROVIDER_ANSWER');
      await consumeProvider(env,p,1);
      return {answer:answer.slice(0,1400),provider:p.label,offline:false};
    } catch(ex) { await audit(env,'system','AI_PROVIDER_ERROR',p.service+':'+ex.message); }
  }
  return {answer:'AI providers unavailable or quota exhausted. No paid provider was used; check Providers and credit limits.',provider:null,offline:true};
}
async function notify(env,incident) {
  const providers=candidateProviders(await allProviders(env,'notify'),'notify',env.ZERO_SPEND==='true');
  for(const p of providers) {
    if(p.service!=='telegram') continue;
    try {
      const credentials=await unseal(p.credentials_cipher,env);
      const msg='🚨 Sabu AI Ops\n'+incident.severity.toUpperCase()+': '+incident.title+'\n'+incident.detail.slice(0,320)+'\nIncident '+incident.id.slice(0,8);
      const r=await fetch('https://api.telegram.org/bot'+credentials.botToken+'/sendMessage',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:credentials.chatId,text:msg}),signal:AbortSignal.timeout(8000)});
      if(r.ok) { await consumeProvider(env,p,1); return true; }
      const state=classifyProviderFailure(r.status,(await r.text()).slice(0,500));
      if(state==='invalid'||state==='exhausted') await markProvider(env,p.id,state,'Telegram request failed: '+r.status);
    } catch(e) { await audit(env,'system','NOTIFY_ERROR',e.message); }
  }
  return false;
}
async function makeIncident(env,{projectId=null,source='health',severity='critical',title,detail,fingerprint}) {
  const prev=await env.DB.prepare("SELECT id FROM incidents WHERE fingerprint=? AND status IN ('open','investigating','pending_approval') ORDER BY detected_at DESC LIMIT 1").bind(fingerprint).first();
  if(prev) return {id:prev.id,created:false};
  const id=newId();
  await env.DB.prepare('INSERT INTO incidents(id,project_id,source,severity,title,detail,status,detected_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,projectId,source,severity,String(title).slice(0,160),String(detail).slice(0,1200),'open',iso(),fingerprint).run();
  await notify(env,{id,severity,title,detail});
  if(projectId&&severity==='critical') {
    const project=await env.DB.prepare('SELECT auto_call FROM projects WHERE id=?').bind(projectId).first();
    if(project?.auto_call) {
      try { await startCall(env,id); } catch(ex) { await audit(env,'system','AUTO_CALL_ERROR',String(ex.message)); }
    }
  }
  return {id,created:true};
}
async function probeProject(env,p) {
  if(!allowedMonitorURL(p.url)) return {ok:false,code:0,error:'Disallowed URL'};
  let code=0,error='';
  try {
    const r=await fetch(p.url,{method:'GET',redirect:'manual',headers:{'user-agent':'SabuAIHealthMonitor/1.0'},signal:AbortSignal.timeout(7500)});
    code=r.status;
  } catch(e) { error='Network or timeout error'; }
  const ok=code>=200 && code<400;
  await env.DB.prepare('UPDATE projects SET last_status=?,last_code=?,last_checked=? WHERE id=?').bind(ok?'healthy':'down',code||null,iso(),p.id).run();
  if(!ok) await makeIncident(env,{projectId:p.id,severity:'critical',source:'health',title:p.name+' is unreachable',detail:code?'HTTP '+code+' at '+p.url:error+' at '+p.url,fingerprint:'health:'+p.id});
  if(ok) {
    await env.DB.prepare("UPDATE incidents SET status='resolved',resolved_at=? WHERE project_id=? AND source='health' AND status IN ('open','investigating')").bind(iso(),p.id).run();
  }
  return {ok,code,error};
}
async function checkPublicGithubRun(env,p) {
  if(!p.repo || !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) return;
  try {
    const url='https://api.github.com/repos/'+p.repo+'/actions/runs?per_page=2';
    const r=await fetch(url,{headers:{'accept':'application/vnd.github+json','user-agent':'SabuAI-Ops'},signal:AbortSignal.timeout(6500)});
    if(!r.ok) return; // Private repos require a signed webhook (not unsafe anonymous polling).
    const data=await r.json();
    const latest=(data.workflow_runs||[]).find(x=>x.status==='completed');
    if(!latest||latest.conclusion!=='failure'||Date.parse(latest.created_at)<Date.parse(p.created_at)) return;
    await makeIncident(env,{projectId:p.id,source:'github',severity:'critical',title:'GitHub workflow failed: '+p.name,
      detail:'Failed workflow '+String(latest.name||'')+'; '+String(latest.html_url||''),fingerprint:'github:'+latest.id});
  } catch(ex) { await audit(env,'system','GITHUB_POLL_ERROR',p.id+':'+ex.message); }
}
async function monitor(env) {
  const rows=(await env.DB.prepare('SELECT * FROM projects WHERE enabled=1 LIMIT 30').all()).results||[];
  let failed=0;
  for(const p of rows) { try { const result=await probeProject(env,p); if(!result.ok) failed++; } catch(e) { failed++; await audit(env,'system','MONITOR_ERROR',p.id+':'+e.message); } }
  // Restrict Github polling to 15 public repositories to respect anonymous API rate limits.
  for(const p of rows.filter(x=>x.repo).slice(0,15)) await checkPublicGithubRun(env,p);
  return {checked:rows.length,failed,githubPolled:Math.min(15,rows.filter(x=>x.repo).length)};
}
const twiml = content => new Response('<?xml version="1.0" encoding="UTF-8"?><Response>'+content+'</Response>',{headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}});
async function twilioValid(req,env,form) {
  const sig=req.headers.get('x-twilio-signature')||'';
  if(!sig) return false;
  const url=new URL(req.url);
  const all=await allProviders(env,'call');
  const pid=url.searchParams.get('provider');
  const p=all.find(x=>x.id===pid&&x.service==='twilio');
  if(!p) return false;
  const c=await unseal(p.credentials_cipher,env);
  const parts=Array.from(form.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const input=req.url+parts.map(([k,v])=>k+v).join('');
  const key=await crypto.subtle.importKey('raw',te.encode(c.authToken),{name:'HMAC',hash:'SHA-1'},false,['sign']);
  const computed=bytesToB64(await crypto.subtle.sign('HMAC',key,te.encode(input)));
  return constantEquals(computed,sig);
}
function callPrompt(s) { return `You are a brief phone assistant for a software project owner. Answer in short spoken Hinglish, with simple Nepali if appropriate. Never invent facts, passwords or payment details. Only discuss this incident and its observed status: ${s}. Never claim deployments were executed. If the owner says fix it, say a dashboard approval is required before making changes. Question: `; }
async function handleTwilio(req,env,url) {
  const form=new URLSearchParams(await req.text());
  if(!await twilioValid(req,env,form)) return err('BAD_TWILIO_SIGNATURE',403);
  const id=url.searchParams.get('id'),call=await env.DB.prepare('SELECT * FROM calls WHERE id=?').bind(id).first();
  if(!call) return twiml('<Say>Call not found. Goodbye.</Say>');
  const incident=await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(call.incident_id).first();
  if(!incident) return twiml('<Say>Incident not found.</Say>');
  const path=url.pathname;
  const actionURL=new URL(req.url);actionURL.pathname='/twilio/reply';
  if(path==='/twilio/start') {
    await env.DB.prepare("UPDATE calls SET state='in_progress' WHERE id=?").bind(id).run();
    const intro=`Hello. Sabu AI Ops calling about ${incident.title}. ${incident.detail.slice(0,240)}. Ask me a question, or say diagnose to request a safe investigation.`;
    return twiml('<Say voice="alice">'+xmlSafe(intro)+'</Say><Gather input="speech" timeout="5" speechTimeout="auto" action="'+xmlSafe(actionURL.toString())+'" method="POST"><Say>What would you like to know?</Say></Gather><Say>No response received. Goodbye.</Say>');
  }
  const speech=String(form.get('SpeechResult')||'').slice(0,400);
  if(!speech) return twiml('<Say>Sorry, I did not hear a question. Goodbye.</Say>');
  let answer='';
  if(/\b(diagnose|investigate|check issue|fix)\b/i.test(speech)) {
    await env.DB.prepare('INSERT INTO approvals(id,incident_id,requested_action,status,source,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(newId(),incident.id,'diagnose','pending','voice',speech,iso()).run();
    answer='I recorded your request to investigate. Please confirm it in the secure admin dashboard. No code or payment changes have been made.';
  } else {
    const ai=await aiText(env,callPrompt(incident.title+'. '+incident.detail)+speech);
    answer=ai.answer;
  }
  const turns=(call.turns||0)+1;
  await env.DB.prepare("UPDATE calls SET transcript=substr(transcript || ?,1,5000),decision=?,turns=? WHERE id=?").bind('\nQ: '+speech+'\nA: '+answer,answer,turns,id).run();
  if(turns>=3) return twiml('<Say voice="alice">'+xmlSafe(answer.slice(0,700))+'</Say><Say>That is all for this short call. Check your dashboard for more. Goodbye.</Say>');
  return twiml('<Say voice="alice">'+xmlSafe(answer.slice(0,700))+'</Say><Gather input="speech" timeout="5" speechTimeout="auto" action="'+xmlSafe(actionURL.toString())+'" method="POST"><Say>Any other question?</Say></Gather><Say>Goodbye.</Say>');
}
async function startCall(env,incidentId) {
  const incident=await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(incidentId).first();
  if(!incident) return {error:'INCIDENT_NOT_FOUND',status:404};
  const destination=await setting(env,'phone','');
  if(!/^\+9779\d{9}$/.test(destination)) return {error:'SET_NEPAL_MOBILE_FIRST',status:409};
  const providers=candidateProviders(await allProviders(env,'call'),'call',env.ZERO_SPEND==='true').filter(p=>p.service==='twilio' && p.plan==='trial' && p.quota_units!==null && Number(p.quota_units)-Number(p.used_units)>=2);
  if(!providers.length) return {error:'NO_ELIGIBLE_FREE_CALL_ACCOUNT',status:409};
  const publicBase=await setting(env,'public_base_url','');
  if(!/^https:\/\//.test(publicBase)) return {error:'SET_PUBLIC_URL_FIRST',status:409};
  for(const p of providers) {
    const c=await unseal(p.credentials_cipher,env),id=newId();
    const start=new URL(publicBase+'/twilio/start');start.searchParams.set('id',id);start.searchParams.set('provider',p.id);
    const reply=new URL(publicBase+'/twilio/reply');reply.searchParams.set('id',id);reply.searchParams.set('provider',p.id);
    await env.DB.prepare('INSERT INTO calls(id,incident_id,provider_id,destination_tail,started_at) VALUES(?,?,?,?,?)').bind(id,incidentId,p.id,destination.slice(-4),iso()).run();
    const params=new URLSearchParams({To:destination,From:c.fromNumber,Url:start.toString(),Method:'POST',StatusCallback:publicBase+'/twilio/status?id='+id+'&provider='+p.id,StatusCallbackMethod:'POST',StatusCallbackEvent:'completed',TimeLimit:'120'});
    const auth=btoa(c.accountSid+':'+c.authToken);
    try {
      // A zero-budget call is allowed only while Twilio itself reports an active Trial account.
      const accountResp=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(c.accountSid)+'.json',{headers:{authorization:'Basic '+auth},signal:AbortSignal.timeout(8000)});
      const account=accountResp.ok?await accountResp.json():{};
      if(!accountResp.ok || account.type!=='Trial' || account.status!=='active') {
        await markProvider(env,p.id,'paused','Not confirmed as active Twilio trial account');
        continue;
      }
      const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(c.accountSid)+'/Calls.json',{method:'POST',headers:{authorization:'Basic '+auth,'content-type':'application/x-www-form-urlencoded'},body:params.toString(),signal:AbortSignal.timeout(10000)});
      const data=await r.json();
      if(r.ok&&data.sid) {
        await env.DB.prepare('UPDATE calls SET external_id=?,state=? WHERE id=?').bind(data.sid,'queued',id).run();
        await consumeProvider(env,p,2); // Reserve full 2-minute max per call; local estimate.
        return {callId:id,provider:p.label,status:'queued',note:'Call placed with provider. Trial restrictions still apply.'};
      }
      const state=classifyProviderFailure(r.status,JSON.stringify(data));
      if(state==='exhausted'||state==='invalid') await markProvider(env,p.id,state,'Twilio rejected call '+r.status);
      await env.DB.prepare('UPDATE calls SET state=? WHERE id=?').bind('failed',id).run();
    } catch(e) { await audit(env,'system','CALL_ERROR',e.message); }
  }
  return {error:'CALL_PROVIDERS_UNAVAILABLE',status:409};
}
async function createProvider(body,env) {
  const {label,service,plan,kind,priority,quota_units,config,credentials,free_verified}=body;
  const pairs={gemini:'ai',openai:'ai',twilio:'call',telegram:'notify'};
  if(!pairs[service]||pairs[service]!==kind||!['free','trial','paid'].includes(plan)||!label||String(label).length>80) return {error:'INVALID_PROVIDER'};
  if(!credentials||typeof credentials!=='object') return {error:'MISSING_CREDENTIALS'};
  if(['openai','gemini'].includes(service)&&(!credentials.apiKey||String(credentials.apiKey).length<12)) return {error:'MISSING_API_KEY'};
  if(service==='twilio'&&(!/^AC[0-9a-f]{32}$/i.test(credentials.accountSid||'')||!credentials.authToken||!/^\+\d{7,15}$/.test(credentials.fromNumber||''))) return {error:'INVALID_TWILIO_CONFIG'};
  if(service==='telegram'&&(!/^\d+:[\w-]+$/.test(credentials.botToken||'')||!String(credentials.chatId||'').trim())) return {error:'INVALID_TELEGRAM_CONFIG'};
  const configSafe=service==='gemini'||service==='openai'?{model:String(config?.model||'').slice(0,70)}:{};
  const id=newId(),enc=await seal(credentials,env);
  await env.DB.prepare('INSERT INTO provider_accounts(id,label,service,kind,plan,priority,enabled,state,free_verified,quota_units,config_json,credentials_cipher,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,String(label).trim(),service,kind,plan,clamp(priority||50,1,999),1,'ready',Number(free_verified)?1:0,quota_units==null?null:clamp(quota_units,0,10000000),JSON.stringify(configSafe),enc,iso()).run();
  await audit(env,'admin','PROVIDER_ADDED',service+' '+id);
  return {id};
}
async function api(req,env,url) {
  const method=req.method,path=url.pathname;
  if(method==='GET'&&path==='/api/bootstrap') {
    const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM admins').first();
    return j({needsSetup:!count.count,zeroSpend:env.ZERO_SPEND==='true',name:env.PUBLIC_APP_NAME||'Sabu AI Ops'});
  }
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!requireOrigin(req)) return err('ORIGIN_REQUIRED',403);
  if(method==='POST'&&path==='/api/setup') {
    const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM admins').first();
    if(count.count) return err('SETUP_ALREADY_COMPLETED',409);
    if(!env.BOOTSTRAP_TOKEN) return err('SERVER_BOOTSTRAP_TOKEN_NOT_SET',503);
    const b=await readBody(req);
    if(b.setupToken!==env.BOOTSTRAP_TOKEN) return err('INVALID_SETUP_TOKEN',403);
    if(!/^[a-zA-Z0-9_.-]{3,32}$/.test(b.username||'')||String(b.password||'').length<14||String(b.password||'').length>256) return err('USERNAME_OR_PASSWORD_INVALID');
    const salt=bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    const hash=await passHash(b.password,salt);
    await env.DB.prepare('INSERT INTO admins(id,username,password_salt,password_hash,created_at) VALUES(?,?,?,?,?)').bind(newId(),b.username,salt,hash,iso()).run();
    return j({ok:true});
  }
  if(method==='POST'&&path==='/api/login') {
    const b=await readBody(req),key=(req.headers.get('cf-connecting-ip')||'unknown').slice(0,80);
    const attempt=await env.DB.prepare('SELECT * FROM login_attempts WHERE key=?').bind(key).first();
    if(attempt&&attempt.count>=6&&Date.now()-attempt.first_at<15*60000) return err('LOGIN_LOCKED_15_MINUTES',429);
    const user=await env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(String(b.username||'')).first();
    const password=String(b.password||'');
    const matches=!!user&&password.length<257&&await passHash(password,user.password_salt)===user.password_hash;
    if(!matches) {
      const first=attempt&&Date.now()-attempt.first_at<15*60000?attempt.first_at:Date.now();
      const count=attempt&&first===attempt.first_at?attempt.count+1:1;
      await env.DB.prepare('INSERT INTO login_attempts(key,count,first_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,first_at=excluded.first_at').bind(key,count,first).run();
      return err('LOGIN_FAILED',401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(key).run();
    const token=bytesToB64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('/','_').replaceAll('+','-');
    await env.DB.prepare('INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES(?,?,?)').bind(await digest(token),user.id,new Date(Date.now()+5*86400000).toISOString()).run();
    await audit(env,'admin','LOGIN',user.username);
    return j({ok:true,username:user.username},200,{'set-cookie':`sabu_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=432000`});
  }
  const admin=await currentAdmin(req,env);
  if(!admin) return err('UNAUTHORIZED',401);
  if(method==='GET'&&path==='/api/session') return j({username:admin.username,authenticated:true,zeroSpend:env.ZERO_SPEND==='true'});
  if(method==='GET'&&path==='/api/onboarding') {
    const [p,accounts]=await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM provider_accounts').first()
    ]);
    return j({completed:(await setting(env,'onboarding_complete'))==='1',
      phone:await setting(env,'phone'),appUrl:new URL(req.url).origin,
      projectCount:p.n,accountCount:accounts.n,zeroSpend:env.ZERO_SPEND==='true'});
  }
  if(method==='POST'&&path==='/api/onboarding/finish') {
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES('onboarding_complete','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    await audit(env,'admin','ONBOARDING_COMPLETED');
    return j({ok:true});
  }

  if(method==='POST'&&path==='/api/logout') {
    const token=(req.headers.get('cookie')||'').match(/(?:^|;\s*)sabu_session=([^;]+)/)?.[1];
    if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
    return j({ok:true},200,{'set-cookie':'sabu_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if(method==='GET'&&path==='/api/overview') {
    const [p,i,c,a]=(await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM projects').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'resolved'").first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM calls').first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'").first()
    ]));
    return j({projects:p.n,openIncidents:i.n,calls:c.n,pendingApprovals:a.n,zeroSpend:env.ZERO_SPEND==='true'});
  }
  if(method==='GET'&&path==='/api/projects') return j({items:(await env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC').all()).results});
  if(method==='POST'&&path==='/api/projects') {
    const b=await readBody(req);
    if(!b.name||String(b.name).length>80||!allowedMonitorURL(b.url)||b.repo&&!/^[\w.-]+\/[\w.-]+$/.test(b.repo)) return err('INVALID_PROJECT_NAME_URL_OR_REPO');
    const id=newId();
    await env.DB.prepare('INSERT INTO projects(id,name,url,repo,auto_call,created_at) VALUES(?,?,?,?,?,?)').bind(id,String(b.name).trim(),String(b.url),String(b.repo||''),b.auto_call?1:0,iso()).run();
    await audit(env,'admin','PROJECT_ADDED',id);
    return j({id},201);
  }
  let match=path.match(/^\/api\/projects\/([a-f0-9-]+)\/auto-call$/);
  if(match&&method==='POST') { const b=await readBody(req);await env.DB.prepare('UPDATE projects SET auto_call=? WHERE id=?').bind(b.enabled?1:0,match[1]).run();await audit(env,'admin','PROJECT_AUTO_CALL_SET',match[1]+':'+!!b.enabled);return j({ok:true}); }
  match=path.match(/^\/api\/projects\/([a-f0-9-]+)$/);
  if(match&&method==='DELETE') {
    await env.DB.prepare('UPDATE projects SET enabled=0 WHERE id=?').bind(match[1]).run();
    await audit(env,'admin','PROJECT_DISABLED',match[1]);return j({ok:true});
  }
  if(method==='POST'&&path==='/api/monitor/run') { const r=await monitor(env);return j(r); }
  if(method==='GET'&&path==='/api/incidents') return j({items:(await env.DB.prepare('SELECT i.*,p.name AS project_name FROM incidents i LEFT JOIN projects p ON p.id=i.project_id ORDER BY i.detected_at DESC LIMIT 100').all()).results});
  if(method==='POST'&&path==='/api/incidents/demo') {
    const r=await makeIncident(env,{source:'demo',severity:'info',title:'Demo incident',detail:'This is a safe test alert. No actual service is down.',fingerprint:'demo:'+newId()});return j(r);
  }
  match=path.match(/^\/api\/incidents\/([a-f0-9-]+)\/resolve$/);
  if(match&&method==='POST') {await env.DB.prepare("UPDATE incidents SET status='resolved',resolved_at=? WHERE id=?").bind(iso(),match[1]).run();return j({ok:true});}
  match=path.match(/^\/api\/incidents\/([a-f0-9-]+)\/call$/);
  if(match&&method==='POST') { const r=await startCall(env,match[1]);return r.error?err(r.error,r.status):j(r); }
  match=path.match(/^\/api\/incidents\/([a-f0-9-]+)\/analyze$/);
  if(match&&method==='POST') {
    const incident=await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(match[1]).first();
    if(!incident) return err('INCIDENT_NOT_FOUND',404);
    const r=await aiText(env,'Give a cautious, concise incident diagnosis with 2 safe options. Do not claim you checked logs. Observed incident: '+incident.title+'\n'+incident.detail);
    return j(r);
  }
  if(method==='GET'&&path==='/api/providers') return j({items:(await allProviders(env)).map(publicProvider)});
  if(method==='POST'&&path==='/api/providers') {
    const res=await createProvider(await readBody(req),env);return res.error?err(res.error):j(res,201);
  }
  match=path.match(/^\/api\/providers\/([a-f0-9-]+)$/);
  if(match&&method==='PATCH') {
    const b=await readBody(req);const p=await env.DB.prepare('SELECT * FROM provider_accounts WHERE id=?').bind(match[1]).first();
    if(!p) return err('PROVIDER_NOT_FOUND',404);
    const state=['ready','paused','exhausted','cooldown','invalid'].includes(b.state)?b.state:p.state;
    const enabled=b.enabled===undefined?p.enabled:(b.enabled?1:0);
    await env.DB.prepare('UPDATE provider_accounts SET state=?,enabled=?,priority=?,quota_units=?,used_units=?,free_verified=? WHERE id=?').bind(state,enabled,clamp(b.priority??p.priority,1,999),b.quota_units===undefined?p.quota_units:(b.quota_units===null?null:clamp(b.quota_units,0,10000000)),b.used_units===undefined?p.used_units:clamp(b.used_units,0,10000000),b.free_verified===undefined?p.free_verified:(b.free_verified?1:0),match[1]).run();
    await audit(env,'admin','PROVIDER_UPDATED',match[1]);return j({ok:true});
  }
  if(match&&method==='DELETE') {
    await env.DB.prepare('DELETE FROM provider_accounts WHERE id=?').bind(match[1]).run();
    await audit(env,'admin','PROVIDER_DELETED',match[1]);return j({ok:true});
  }
  if(method==='GET'&&path==='/api/routing') {
    const all=await allProviders(env);
    return j({voice:candidateProviders(all,'call',true).filter(p=>p.plan==='trial'&&p.quota_units!==null&&p.quota_units-p.used_units>=2).map(p=>({id:p.id,label:p.label,service:p.service})),ai:candidateProviders(all,'ai',true).filter(p=>p.service==='gemini').map(p=>({id:p.id,label:p.label,service:p.service})),notify:candidateProviders(all,'notify',true).map(p=>({id:p.id,label:p.label,service:p.service}))});
  }
  if(method==='GET'&&path==='/api/settings') {
    return j({phone:await setting(env,'phone'),public_base_url:await setting(env,'public_base_url'),zeroSpend:env.ZERO_SPEND==='true'});
  }
  if(method==='POST'&&path==='/api/settings') {
    const b=await readBody(req);
    if(b.phone!==undefined) {
      if(b.phone&&!/^\+9779\d{9}$/.test(b.phone)) return err('PHONE_MUST_USE_NEPAL_E164');
      await env.DB.prepare("INSERT INTO settings(key,value) VALUES('phone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(b.phone).run();
    }
    if(b.public_base_url!==undefined) {
      const origin=new URL(req.url).origin;
      if(b.public_base_url!==origin) return err('PUBLIC_URL_MUST_MATCH_THIS_APP_ORIGIN');
      await env.DB.prepare("INSERT INTO settings(key,value) VALUES('public_base_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(origin).run();
    }
    await audit(env,'admin','SETTINGS_UPDATED','Phone and/or public URL');return j({ok:true});
  }
  if(method==='GET'&&path==='/api/calls') return j({items:(await env.DB.prepare('SELECT calls.id,calls.incident_id,calls.state,calls.destination_tail,calls.started_at,calls.finished_at,calls.seconds,calls.transcript,calls.decision,provider_accounts.label AS provider_label FROM calls LEFT JOIN provider_accounts ON calls.provider_id=provider_accounts.id ORDER BY calls.started_at DESC LIMIT 60').all()).results});
  if(method==='GET'&&path==='/api/approvals') return j({items:(await env.DB.prepare('SELECT approvals.*,incidents.title AS incident_title FROM approvals LEFT JOIN incidents ON approvals.incident_id=incidents.id ORDER BY approvals.created_at DESC LIMIT 60').all()).results});
  match=path.match(/^\/api\/approvals\/([a-f0-9-]+)\/decision$/);
  if(match&&method==='POST') {
    const b=await readBody(req);
    if(!['approved','rejected'].includes(b.decision)||b.confirm!==`CONFIRM ${b.decision.toUpperCase()}`) return err('EXPLICIT_CONFIRMATION_REQUIRED');
    const row=await env.DB.prepare('SELECT * FROM approvals WHERE id=?').bind(match[1]).first();
    if(!row||row.status!=='pending') return err('APPROVAL_NOT_PENDING',409);
    await env.DB.prepare('UPDATE approvals SET status=?,approved_at=? WHERE id=?').bind(b.decision,iso(),row.id).run();
    await audit(env,'admin','APPROVAL_'+b.decision.toUpperCase(),row.requested_action+':'+row.incident_id);
    if(b.decision==='approved'&&row.requested_action==='diagnose') {
      const jobId=newId(),incident=await env.DB.prepare('SELECT * FROM incidents WHERE id=?').bind(row.incident_id).first();
      await env.DB.prepare('INSERT INTO execution_jobs(id,incident_id,action,approval_id,state,created_at) VALUES(?,?,?,?,?,?)').bind(jobId,row.incident_id,'diagnose',row.id,'running',iso()).run();
      const result=await aiText(env,'Provide a conservative diagnosis and 3 actionable manual troubleshooting steps. Do not claim access to logs or code. Incident: '+incident.title+'; '+incident.detail);
      await env.DB.prepare('UPDATE execution_jobs SET state=?,result=?,finished_at=? WHERE id=?').bind(result.offline?'needs_ai_provider':'completed',result.answer,iso(),jobId).run();
      return j({ok:true,jobId,execution:result.offline?'Decision saved. Add an eligible Gemini account to enable AI diagnostics.':'Approved safe diagnostic job executed; see Jobs for result.'});
    }
    return j({ok:true,execution:'Approval recorded. No write access to external repositories is enabled in this build.'});
  }
  if(method==='GET'&&path==='/api/jobs') return j({items:(await env.DB.prepare('SELECT * FROM execution_jobs ORDER BY created_at DESC LIMIT 60').all()).results});
  if(method==='GET'&&path==='/api/audit') return j({items:(await env.DB.prepare('SELECT * FROM audit ORDER BY created_at DESC LIMIT 100').all()).results});
  return err('NOT_FOUND',404);
}
async function githubWebhook(req,env) {
  if(!env.GITHUB_WEBHOOK_SECRET) return err('GITHUB_WEBHOOK_DISABLED',503);
  const raw=await req.text();if(raw.length>50000) return err('WEBHOOK_TOO_LARGE',413);
  const signature=req.headers.get('x-hub-signature-256');
  const key=await crypto.subtle.importKey('raw',te.encode(env.GITHUB_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected='sha256='+hex(await crypto.subtle.sign('HMAC',key,te.encode(raw)));
  if(!constantEquals(signature,expected)) return err('INVALID_SIGNATURE',403);
  const event=req.headers.get('x-github-event'),data=safeJson(raw,{});
  if(event==='workflow_run'&&data.action==='completed'&&data.workflow_run?.conclusion==='failure') {
    const repo=String(data.repository?.full_name||'');
    const projects=(await env.DB.prepare('SELECT * FROM projects WHERE repo=? AND enabled=1').bind(repo).all()).results||[];
    for(const p of projects) {
      await makeIncident(env,{projectId:p.id,source:'github',severity:'critical',title:'GitHub Actions failure: '+p.name,detail:'Workflow '+String(data.workflow_run.name||'')+' failed. Run: '+String(data.workflow_run.html_url||''),fingerprint:'github:'+String(data.workflow_run.id)});
    }
  }
  return j({ok:true});
}
export default {
  async fetch(req,env) {
    const url=new URL(req.url);
    try {
      if(url.pathname==='/health') return j({ok:true,app:'Sabu AI Ops',version:'1.1.0'});
      if(url.pathname.startsWith('/webhooks/github')) return githubWebhook(req,env);
      if(url.pathname==='/twilio/status'&&req.method==='POST') {
        const form=new URLSearchParams(await req.text());if(!await twilioValid(req,env,form))return err('INVALID_TWILIO_SIGNATURE',403);
        await env.DB.prepare('UPDATE calls SET state=?,seconds=?,finished_at=? WHERE id=?').bind(String(form.get('CallStatus')||'unknown').slice(0,30),clamp(form.get('CallDuration')||0,0,3600),iso(),url.searchParams.get('id')).run();return new Response('ok');
      }
      if(url.pathname.startsWith('/twilio/')) return req.method==='POST'?handleTwilio(req,env,url):err('METHOD_NOT_ALLOWED',405);
      if(url.pathname.startsWith('/api/')) return api(req,env,url);
      return env.ASSETS.fetch(req);
    } catch(e) {
      console.error('Request error',url.pathname,String(e?.message||e).slice(0,100));
      return err(['MISSING_ENCRYPTION_KEY','INVALID_ENCRYPTION_KEY'].includes(e?.message)?e.message:'SERVER_ERROR',500);
    }
  },
  async scheduled(event,env,ctx) { ctx.waitUntil(monitor(env)); }
};
