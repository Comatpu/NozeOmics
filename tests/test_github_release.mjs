// Actual published release gate. Only a disposable workspace/config is used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const work=fs.mkdtempSync(path.join(root,'.local','github-release-'));
const home=path.join(work,'data'),codex=path.join(work,'codex');
fs.mkdirSync(home);fs.writeFileSync(path.join(home,'keep.txt'),'preserved');
const env={...process.env,NOZEOMICS_HOME:home,CODEX_HOME:codex};delete env.ELECTRON_RUN_AS_NODE;
const base=path.join(root,'release/NozeOmics-win32-x64');
const exe=path.join(work,'release-check.exe');
const testConfig=path.join(work,'UpdateConfig.cs');
const original=fs.readFileSync(path.join(root,'.build/portable/UpdateConfig.cs'),'utf8');
fs.writeFileSync(testConfig,original.replace('public const string Version = "'+cfg.version+'"','public const string Version = "0.0.0"'));
const compile=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/main:UpdateHarness','/platform:x64','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+exe,path.join(root,'desktop/PortableUpdates.cs'),path.join(root,'desktop/PortableLauncher.cs'),testConfig,path.join(root,'tests/UpdateHarness.cs')],{windowsHide:true,encoding:'utf8'});
assert.equal(compile.status,0,compile.stdout+compile.stderr);
const run=(...args)=>spawnSync(exe,args,{env,windowsHide:true,encoding:'utf8',timeout:120000});
const feed='https://github.com/'+cfg.repository+'/releases/latest/download/latest.json';
const response=await fetch(feed,{signal:AbortSignal.timeout(15000)});assert(response.ok,'Public release feed is unavailable');
const envelope=await response.text(),manifest=path.join(work,'latest.json');fs.writeFileSync(manifest,envelope);
assert.equal(run('verify',manifest).stdout.trim(),cfg.version);
const payload=JSON.parse(Buffer.from(JSON.parse(envelope).payload,'base64'));
const result=run('select-online',home,base);assert.equal(result.status,0,result.stderr);
const selected=JSON.parse(result.stdout);assert.equal(selected.pending,true,fs.existsSync(path.join(home,'updates/updates.log'))?fs.readFileSync(path.join(home,'updates/updates.log'),'utf8'):'No newer update selected');
assert.equal(selected.version,cfg.version);
const archive=path.join(home,'updates',payload.app.sha256+'.zip');
assert.equal(fs.statSync(archive).size,payload.app.size);
const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(archive))hash.update(bytes);
assert.equal(hash.digest('hex'),payload.app.sha256);
let connection;
try{
 const launch=spawnSync(exe,['launch',home,base,manifest,path.join(root,'.build/portable/NozeOmics.exe')],{env,windowsHide:true,stdio:'ignore',timeout:120000});assert.equal(launch.status,0,'Updated application did not start');
 assert.equal(fs.readFileSync(path.join(home,'updates/active.json'),'utf8'),envelope);
 connection=JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));
 const health=await(await fetch(connection.url+'/health',{signal:AbortSignal.timeout(5000)})).json();assert.equal(health.version,cfg.version);
 assert.equal(fs.readFileSync(path.join(home,'keep.txt'),'utf8'),'preserved');
 const remote=await(await fetch('https://api.github.com/repos/'+cfg.repository+'/releases/tags/v'+cfg.version,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json'}})).json();
 assert.equal(remote.draft,false);assert.equal(remote.prerelease,false);
 for(const name of ['NozeOmics.exe','NozeOmics-app.zip','NozeOmics-runtime.zip','latest.json']){
  const asset=remote.assets.find(a=>a.name===name);assert(asset,'Missing release asset '+name);
  const file=path.join(root,'.build/updates/v'+cfg.version,name);assert.equal(asset.size,fs.statSync(file).size);
  assert.equal(asset.state,'uploaded');
  if(asset.digest){const local=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))local.update(bytes);assert.equal(asset.digest,'sha256:'+local.digest('hex'));}
 }
 console.log('PASS: public GitHub feed, publisher signature, actual app download/hash, healthy UI startup/activation, preserved data, and all four uploaded release assets.');
}finally{
 spawnSync(path.join(selected.runtime,'NozeOmics.exe'),['--quit'],{env,windowsHide:true,stdio:'ignore',timeout:25000});
}
