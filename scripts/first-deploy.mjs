// One-command Cloudflare installer for a browser-hosted GitHub Codespace.
// Needs Node >=20, npm install, and Wrangler authentication in the current session.
// Intentionally never uploads provider API credentials; they are added inside the admin portal.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cfgFile=resolve(root,'wrangler.jsonc');
const bootstrapFile=resolve(root,'.bootstrap-token');
const command=process.platform==='win32'?'npx.cmd':'npx';
function wrangler(args, {json=false,input}={}) {
  const result=spawnSync(command,['--no-install','wrangler',...args],{
    cwd:root, encoding:'utf8', env:{...process.env,CI:'true'},
    input, maxBuffer:5*1024*1024,
  });
  if(result.error||result.status!==0){
    process.stderr.write((result.stderr||result.stdout||String(result.error)||'Command failed')+'\n');
    throw new Error(`Wrangler failed: ${args.join(' ')}`);
  }
  if(!json){if(result.stdout.trim()) process.stdout.write(result.stdout+'\n');return result.stdout}
  try{return JSON.parse(result.stdout)}catch{
    const start=result.stdout.indexOf('[');
    if(start>=0){try{return JSON.parse(result.stdout.slice(start))}catch{}}
    throw new Error(`Could not parse Wrangler JSON from ${args.join(' ')}. Please update Wrangler.`)
  }
}
function config(){return JSON.parse(readFileSync(cfgFile,'utf8'))}
function saveConfig(c){writeFileSync(cfgFile,JSON.stringify(c,null,2)+'\n')}
function makeToken(){return randomBytes(32).toString('hex')}
function makeKey(){return randomBytes(32).toString('base64')}
if(process.argv.includes('--check-plan')){
  const c=config();
  console.log(JSON.stringify({mode:'dry-run',worker:c.name,database:c.d1_databases?.[0]?.database_name,
    migrations:'migrations/*.sql',secrets:['BOOTSTRAP_TOKEN','ENCRYPTION_KEY'],
    backend:'Cloudflare Worker',frontend:c.assets.directory,paid:'disabled'},null,2));
  process.exit(0);
}
try{
  console.log('\nSabu AI Ops — Cloudflare one-command installer');
  console.log('No payment-enabled services or phone calls will be activated.');
  let c=config();
  if(c.vars.ZERO_SPEND!=='true') throw Error('Refusing to install: ZERO_SPEND must be true.');
  console.log('\n[1/5] Checking your Cloudflare access and databases…');
  const existing=wrangler(['d1','list','--json'],{json:true});
  if(!Array.isArray(existing)) throw Error('Unexpected D1 database list from Wrangler.');
  const dbName=c.d1_databases?.[0]?.database_name;
  let db=existing.find(x=>x.name===dbName);
  if(!db){
    console.log(`Creating free-plan-compatible D1 database: ${dbName}`);
    wrangler(['d1','create',dbName,'--location','apac']);
    const list=wrangler(['d1','list','--json'],{json:true});
    db=list.find(x=>x.name===dbName);
  }
  const dbId=db?.uuid||db?.id;
  if(!dbId||!/^[0-9a-f-]{32,36}$/i.test(dbId)) throw Error('D1 database ID not found. Setup stopped safely.');
  c.d1_databases[0].database_id=dbId;
  saveConfig(c);
  console.log('Database selected and binding DB updated automatically.');
  console.log('\n[2/5] Creating/updating database tables…');
  wrangler(['d1','migrations','apply','DB','--remote']);
  console.log('\n[3/5] Publishing Worker, API, admin panel and monitoring cron…');
  const output=wrangler(['deploy']);
  console.log('\n[4/5] Checking installation secrets…');
  const secrets=wrangler(['secret','list','--format','json'],{json:true});
  const have=new Set(secrets.map(x=>x.name));
  let bootstrap='';
  if(!have.has('ENCRYPTION_KEY')){
    wrangler(['secret','put','ENCRYPTION_KEY'],{input:makeKey()+'\n'});
    console.log('Generated encrypted-credential master key securely in Cloudflare Workers Secrets.');
  }else console.log('Preserved existing encryption key (important for previously added accounts).');
  if(!have.has('BOOTSTRAP_TOKEN')){
    bootstrap=makeToken();
    wrangler(['secret','put','BOOTSTRAP_TOKEN'],{input:bootstrap+'\n'});
    writeFileSync(bootstrapFile,bootstrap+'\n',{mode:0o600});
    try{chmodSync(bootstrapFile,0o600)}catch{}
  }else if(existsSync(bootstrapFile)) bootstrap=readFileSync(bootstrapFile,'utf8').trim();
  console.log('\n[5/5] Finished.');
  const url=output.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
  console.log('Admin portal: '+(url||'Open the workers.dev URL shown in Cloudflare → Workers & Pages'));
  if(bootstrap) console.log('ONE-TIME BOOTSTRAP TOKEN: '+bootstrap);
  else console.log('Existing bootstrap secret preserved. Use your current admin login.');
  console.log('Open the portal → create admin → enter +977 phone (optional) → add AI/notification accounts → add projects.');
  console.log('Never commit or share the bootstrap token. Setup is single-use.');
} catch(e){
  console.error('\nInstallation did not finish: '+e.message);
  console.error('Fix the reported authorization/configuration problem and rerun npm run first-deploy.');
  process.exitCode=1;
}
