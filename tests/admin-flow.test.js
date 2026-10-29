import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function fakeEnv({secret = true} = {}) {
  const admins=[];
  const sessions=[];
  const env={
    BOOTSTRAP_TOKEN:'test-bootstrap-secret-with-more-than-32-characters',
    ENCRYPTION_KEY:secret?Buffer.alloc(32,19).toString('base64'):undefined,
    ZERO_SPEND:'true',
    ASSETS:{fetch:()=>new Response('static')},
    DB:{prepare(sql){
      const makeStatement=(args=[])=>({
        bind(...params){return makeStatement(params)},
        async first(){
          if(sql.includes('COUNT(*) AS count FROM admins'))return {count:admins.length};
          if(sql.includes('FROM admins WHERE username=?'))return admins.find(x=>x.username===args[0])||null;
          if(sql.includes('FROM login_attempts'))return null;
          return null;
        },
        async run(){
          if(sql.startsWith('INSERT INTO admins')){
            admins.push({id:args[0],username:args[1],password_salt:args[2],password_hash:args[3]});
          }
          if(sql.startsWith('INSERT INTO sessions'))sessions.push(args);
          return {success:true};
        }
      });
      return makeStatement();
    }}
  };
  return {env,admins,sessions};
}
function req(method,path,body){
  return new Request('https://example.workers.dev'+path,{
    method,headers:{origin:'https://example.workers.dev','content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}

test('free-tier admin setup, sign-in and verifier compatibility',async()=>{
  const {env,admins,sessions}=fakeEnv();
  const boot=await worker.fetch(req('GET','/api/bootstrap'),env);
  assert.equal(boot.status,200);
  assert.deepEqual((await boot.json()).setupChecks,{bootstrapToken:true,encryptionKey:true});
  const setup=await worker.fetch(req('POST','/api/setup',{
    setupToken:env.BOOTSTRAP_TOKEN,username:'test-owner',password:'this-is-a-unique-very-long-password'
  }),env);
  assert.equal(setup.status,200);
  assert.equal(admins.length,1);
  assert.match(admins[0].password_hash,/^hmac-v2:[a-f0-9]{64}$/);
  const login=await worker.fetch(req('POST','/api/login',{
    username:'test-owner',password:'this-is-a-unique-very-long-password'
  }),env);
  assert.equal(login.status,200);
  assert.equal(sessions.length,1);
  assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  const wrong=await worker.fetch(req('POST','/api/login',{
    username:'test-owner',password:'wrong-password'
  }),env);
  assert.equal(wrong.status,401);
});

test('missing encryption key returns JSON error, never an HTML worker exception',async()=>{
  const {env,admins}=fakeEnv({secret:false});
  const setup=await worker.fetch(req('POST','/api/setup',{
    setupToken:env.BOOTSTRAP_TOKEN,username:'test-owner',password:'this-is-a-unique-very-long-password'
  }),env);
  assert.equal(setup.status,500);
  assert.equal((await setup.json()).error,'MISSING_ENCRYPTION_KEY');
  assert.equal(admins.length,0);
});
