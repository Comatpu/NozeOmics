import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=fs.mkdtempSync(path.join(root,'.local','update-tests-'));
const exe=path.join(work,'test-updates.exe');
const csc='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const compilation=spawnSync(csc,['/nologo','/target:exe','/main:UpdateHarness','/platform:x64','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+exe,path.join(root,'desktop/PortableUpdates.cs'),path.join(root,'desktop/PortableLauncher.cs'),path.join(root,'.build/portable/UpdateConfig.cs'),path.join(root,'tests/UpdateHarness.cs')],{windowsHide:true,encoding:'utf8'});
assert.equal(compilation.status,0,compilation.stdout+compilation.stderr);
const run=(...args)=>spawnSync(exe,args,{windowsHide:true,encoding:'utf8'});
const sign=payload=>{const bytes=Buffer.from(JSON.stringify(payload));return JSON.stringify({payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,fs.readFileSync(path.join(root,'.local/release-signing/private.pem'))).toString('base64')});};
const base=path.join(work,'base-'+crypto.randomUUID().slice(0,8)),home=path.join(work,'한글 데이터');
const files=['NozeOmics.exe','resources/app/desktop/main.cjs','resources/app/desktop/preload.cjs','resources/app/mcp/adapter.cjs','resources/app/backend/server.py','resources/app/frontend/index.html','resources/app/runtime/python/python.exe','resources/app/runtime/R/bin/Rscript.exe'];
for(const file of files){fs.mkdirSync(path.dirname(path.join(base,file)),{recursive:true});fs.writeFileSync(path.join(base,file),'original:'+file);}
fs.mkdirSync(path.join(home,'updates'),{recursive:true});fs.writeFileSync(path.join(home,'workspace.json'),'DATA MUST STAY');
const python=path.join(root,'runtime/python/python.exe');
const zipper=(name,records)=>{const definition=path.join(work,name+'.json');fs.writeFileSync(definition,JSON.stringify(records));const result=spawnSync(python,['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.writestr(k,v) for k,v in json.load(open(sys.argv[1],encoding="utf-8")).items()]; z.close()',definition,path.join(work,name+'.zip')],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return path.join(work,name+'.zip');};
const cfg=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const version='0.2.1';
const entries=Object.fromEntries(files.filter(f=>f.startsWith('resources/app/')&&!f.includes('/runtime/')).map(f=>[f.slice('resources/app/'.length),'updated:'+f]));
entries['release.json']=JSON.stringify({...cfg,version});entries['package.json']=JSON.stringify({version});
const archive=zipper('app',entries),bytes=fs.readFileSync(archive),hash=crypto.createHash('sha256').update(bytes).digest('hex');
const asset={url:`https://github.com/${cfg.repository}/releases/download/v${version}/app.zip`,size:bytes.length,sha256:hash};
const payload={schema:1,version,runtime_id:cfg.runtime_id,launcher_protocol:1,data_schema:1,channel:'stable',app:asset,full:asset};
const envelope=sign(payload),manifest=path.join(work,'signed.json');fs.writeFileSync(manifest,envelope);
assert.equal(run('verify',manifest).stdout.trim(),version);
assert.equal(run('compare','0.2.10','0.2.9').stdout.trim(),'1');
assert.notEqual(run('compare','0.2.preview','0.2.0').status,0);
const wrapper=JSON.parse(envelope);wrapper.payload=Buffer.from(JSON.stringify({...payload,version:'99.0.0'})).toString('base64');const bad=path.join(work,'bad.json');fs.writeFileSync(bad,JSON.stringify(wrapper));assert.notEqual(run('verify',bad).status,0);
fs.writeFileSync(bad,sign({...payload,app:{...asset,url:'https://example.com/app.zip'}}));assert.notEqual(run('verify',bad).status,0);
fs.writeFileSync(bad,sign({...payload,data_schema:2}));assert.notEqual(run('verify',bad).status,0);
for(const [i,entry] of ['../escaped.txt','backend/../../escaped.txt','backend:evil','backend/NUL.txt','backend/trailing.'].entries()){const zip=zipper('unsafe'+i,{[entry]:'bad'});assert.notEqual(run('extract',zip,path.join(work,'extract'+i)).status,0);}
assert(!fs.existsSync(path.join(work,'escaped.txt')));
fs.copyFileSync(archive,path.join(home,'updates',hash+'.zip'));assert.equal(run('commit',home,manifest).status,0);
let result=run('select',home,base);assert.equal(result.status,0,result.stderr);let selection=JSON.parse(result.stdout);assert.equal(selection.version,version);assert.equal(fs.readFileSync(path.join(selection.runtime,'resources/app/frontend/index.html'),'utf8'),'updated:resources/app/frontend/index.html');
assert.equal(fs.readFileSync(path.join(base,'resources/app/frontend/index.html'),'utf8'),'original:resources/app/frontend/index.html');
assert.equal(fs.readFileSync(path.join(home,'workspace.json'),'utf8'),'DATA MUST STAY');
assert.equal(JSON.parse(run('select',home,base).stdout).runtime,selection.runtime);
fs.appendFileSync(path.join(home,'updates',hash+'.zip'),'corrupt');selection=JSON.parse(run('select',home,base).stdout);assert.equal(selection.runtime,base);assert.equal(fs.readFileSync(path.join(home,'workspace.json'),'utf8'),'DATA MUST STAY');
console.log('PASS: publisher signature, numeric versions, unsafe archives/URLs/schema rejection, verified cached updates, Korean paths, immutable baseline, offline fallback and preserved user data.');
if(process.argv.includes('--startup')){
 const actualBase=path.join(root,'release/NozeOmics-win32-x64');
 const actual={};const allowed=new Set(['frontend','backend','desktop','mcp','assets','plugin','package.json','release.json']);
 function collect(dir,prefix=''){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const rel=prefix+item.name;if(!prefix&&!allowed.has(item.name))continue;if(item.isDirectory()){if(item.name!=='__pycache__')collect(path.join(dir,item.name),rel+'/');}else if(!item.name.endsWith('.pyc'))actual[rel]=fs.readFileSync(path.join(dir,item.name)).toString('base64');}}
 collect(path.join(actualBase,'resources/app'));
 actual['release.json']=Buffer.from(JSON.stringify({...cfg,version})).toString('base64');
 const pkg=JSON.parse(fs.readFileSync(path.join(actualBase,'resources/app/package.json'),'utf8'));pkg.version=version;actual['package.json']=Buffer.from(JSON.stringify(pkg)).toString('base64');
 async function startup(broken){
  const testHome=path.join(work,broken?'failed-startup':'successful-startup');fs.mkdirSync(path.join(testHome,'updates'),{recursive:true});
  fs.writeFileSync(path.join(testHome,'keep.txt'),'preserved');
  const data={...actual};if(broken)data['desktop/main.cjs']=Buffer.from('process.exit(1);').toString('base64');
  const definition=path.join(work,broken?'broken-files.json':'healthy-files.json'),zip=definition+'.zip';fs.writeFileSync(definition,JSON.stringify(data));
  const pack=spawnSync(python,['-c','import base64,json,sys,zipfile; z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.writestr(k,base64.b64decode(v)) for k,v in json.load(open(sys.argv[1],encoding="utf-8")).items()]; z.close()',definition,zip],{windowsHide:true,encoding:'utf8'});assert.equal(pack.status,0,pack.stderr);
  const b=fs.readFileSync(zip),h=crypto.createHash('sha256').update(b).digest('hex');fs.copyFileSync(zip,path.join(testHome,'updates',h+'.zip'));
  const signed=path.join(work,broken?'broken-start.json':'healthy-start.json');fs.writeFileSync(signed,sign({...payload,app:{...asset,size:b.length,sha256:h}}));
  const launch=spawnSync(exe,['launch',testHome,actualBase,signed,path.join(root,'.build/portable/NozeOmics.exe')],{windowsHide:true,stdio:'ignore',timeout:130000});assert.equal(launch.status,0,'Startup harness failed: '+(launch.error?.message||launch.status));
  const active=path.join(testHome,'updates/active.json');assert.equal(fs.existsSync(active),!broken);
  if(broken)assert(fs.existsSync(path.join(testHome,'updates/rejected.json')));
  let c;for(let i=0;i<100;i++){try{c=JSON.parse(fs.readFileSync(path.join(testHome,'connection.json'),'utf8'));if((await fetch(c.url+'/health',{signal:AbortSignal.timeout(2000)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  assert(c,'No backend started');const health=await(await fetch(c.url+'/health',{signal:AbortSignal.timeout(2000)})).json();assert.equal(health.version,broken?cfg.version:version);assert.equal(fs.readFileSync(path.join(testHome,'keep.txt'),'utf8'),'preserved');
  try {await fetch(c.url+'/api/shutdown',{signal:AbortSignal.timeout(5000),method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:'{}'});}catch{}
  // Close only this isolated test app, via its own executable and data home.
  const selectedRuntime=broken?actualBase:JSON.parse(run('select',testHome,actualBase).stdout).runtime;
  spawnSync(path.join(selectedRuntime,'NozeOmics.exe'),['--quit'],{env:{...process.env,NOZEOMICS_HOME:testHome,ELECTRON_RUN_AS_NODE:''},windowsHide:true,timeout:20000});
 }
 await startup(false);await startup(true);
 console.log('PASS: real Electron/Python startup commits healthy updates; failed candidate returns to the previous version.');
}
