// Test HTTP is enabled only in this separately compiled diagnostic executable.
// The production launcher pins HTTPS GitHub URLs and exposes no feed override.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=fs.mkdtempSync(path.join(root,'.local','update-download-tests-'));
const cfg=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const privateKey=fs.readFileSync(path.join(root,'.local/release-signing/private.pem'));
const sign=p=>{const bytes=Buffer.from(JSON.stringify(p));return JSON.stringify({payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,privateKey).toString('base64')});};
let envelope,mode='good',requests=0,archive;
const server=http.createServer((req,res)=>{if(req.url==='/latest.json'){res.end(envelope);return;}requests++;if(mode==='broken')res.end(archive.subarray(0,32));else res.end(archive);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
const configFile=path.join(work,'TestConfig.cs');
fs.writeFileSync(configFile,fs.readFileSync(path.join(root,'.build/portable/UpdateConfig.cs'),'utf8').replace(/public const string Feed = "[^"]+";/,`public const string Feed = "${url}/latest.json";`));
const exe=path.join(work,'test-downloads.exe'),csc='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
const compile=spawnSync(csc,['/nologo','/target:exe','/main:UpdateHarness','/define:UPDATE_TESTS','/platform:x64','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/out:'+exe,path.join(root,'desktop/PortableUpdates.cs'),path.join(root,'desktop/PortableLauncher.cs'),configFile,path.join(root,'tests/UpdateHarness.cs')],{windowsHide:true,encoding:'utf8'});assert.equal(compile.status,0,compile.stdout+compile.stderr);
const run=(...args)=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(stdout.trim()):reject(new Error(stderr)));});
const base=path.join(work,'embedded-'+crypto.randomUUID().slice(0,8));
const required=['NozeOmics.exe','resources/app/desktop/main.cjs','resources/app/desktop/preload.cjs','resources/app/mcp/adapter.cjs','resources/app/backend/server.py','resources/app/frontend/index.html','resources/app/runtime/python/python.exe','resources/app/runtime/R/bin/Rscript.exe'];
for(const f of required){fs.mkdirSync(path.dirname(path.join(base,f)),{recursive:true});fs.writeFileSync(path.join(base,f),'embedded');}
function zip(version,runtime,full=false){const records=Object.fromEntries(required.filter(f=>full||f.startsWith('resources/app/')&&!f.includes('/runtime/')).map(f=>[full?f:f.slice(14),'updated']));records[(full?'resources/app/':'')+'release.json']=JSON.stringify({...cfg,version,runtime_id:runtime});records[(full?'resources/app/':'')+'package.json']=JSON.stringify({version});const definition=path.join(work,version+'.json'),file=definition+'.zip';fs.writeFileSync(definition,JSON.stringify(records));const result=spawnSync(path.join(root,'runtime/python/python.exe'),['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.writestr(k,v) for k,v in json.load(open(sys.argv[1],encoding="utf-8")).items()]; z.close()',definition,file],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return fs.readFileSync(file);}
function release(version,runtime){const asset={url:url+'/app.zip',size:archive.length,sha256:crypto.createHash('sha256').update(archive).digest('hex')};return {schema:1,version,runtime_id:runtime,launcher_protocol:1,data_schema:1,channel:'stable',app:asset,full:asset};}
const home=path.join(work,'downloaded');fs.mkdirSync(home);fs.writeFileSync(path.join(home,'keep.txt'),'data');
try{
 archive=zip('0.2.1',cfg.runtime_id);envelope=sign(release('0.2.1',cfg.runtime_id));
 let result=JSON.parse(await run('select-online',home,base));assert.equal(result.version,'0.2.1');assert.equal(result.pending,true);assert.equal(requests,1);assert(!fs.existsSync(path.join(home,'updates/active.json')));
 const receipt=path.join(work,'manifest.json');fs.writeFileSync(receipt,envelope);await run('commit',home,receipt);
 result=JSON.parse(await run('select-online',home,base));assert.equal(result.pending,false);assert.equal(requests,1);
 archive=zip('0.2.2',cfg.runtime_id);envelope=sign(release('0.2.2',cfg.runtime_id));mode='broken';result=JSON.parse(await run('select-online',home,base));assert.equal(result.version,'0.2.1');assert(!fs.readdirSync(path.join(home,'updates')).some(f=>f.includes('.part-')));
 mode='good';const before=requests;const tampered=JSON.parse(envelope);tampered.signature=Buffer.alloc(384).toString('base64');envelope=JSON.stringify(tampered);result=JSON.parse(await run('select-online',home,base));assert.equal(result.version,'0.2.1');assert.equal(requests,before);
 // A changed runtime downloads the full bundle once; its next minor release uses an app bundle.
 archive=zip('0.3.0','windows-x64-r2',true);envelope=sign(release('0.3.0','windows-x64-r2'));result=JSON.parse(await run('select-online',home,base));assert.equal(result.full,true);fs.writeFileSync(receipt,envelope);await run('commit',home,receipt,receipt);
 archive=zip('0.3.1','windows-x64-r2');envelope=sign(release('0.3.1','windows-x64-r2'));result=JSON.parse(await run('select-online',home,base));assert.equal(result.pending,true);assert.equal(result.full,false);assert.equal(result.version,'0.3.1');assert.equal(fs.readFileSync(path.join(home,'keep.txt'),'utf8'),'data');
 await new Promise(resolve=>server.close(resolve));result=JSON.parse(await run('select-online',home,base));assert.equal(result.version,'0.3.0');
 console.log('PASS: real download, signature-before-download, no duplicate download, truncated download recovery, offline startup, runtime upgrade then small app patch.');
}finally{server.close();}
