import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire('C:/Users/nojae/OneDrive/Desktop/노제/NozeDock v3/frontend/package.json');
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const home=path.join(root,'.local','connection-ui-'+Date.now());
const exe=path.join(root,'release/NozeOmics-win32-x64/NozeOmics.exe');
const adapter=path.join(path.dirname(exe),'resources/app/mcp/adapter.cjs');
const env={...process.env,NOZEOMICS_HOME:home,CODEX_HOME:path.join(home,'test-codex')};delete env.ELECTRON_RUN_AS_NODE;
const port=9367;
const app=spawn(exe,['--background','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{env,windowsHide:true,stdio:'ignore'});
let client,socket;const pending=new Map();let sequence=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<150;i++){try{const value=await fn();if(value)return value;}catch{}await delay(100);}throw new Error('Timed out waiting for the test desktop.');}
function rpc(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try{
 const connection=await until(()=>JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8')));
 client=new Client({name:'connection-ui-check',version:'1'},{capabilities:{}});
 await client.connect(new StdioClientTransport({command:exe,args:[adapter],env:{...env,ELECTRON_RUN_AS_NODE:'1',NOZEOMICS_EXE:exe}}));
 let result=await client.callTool({name:'nozeomics_get_state',arguments:{}});assert.equal(!!result.isError,false);
 let state=JSON.parse(result.content[0].text);assert.equal(state.projects.length,0);
 result=await client.callTool({name:'nozeomics_open_project',arguments:{name:'UI connection verification',base_revision:state.revision}});assert.equal(!!result.isError,false);
 const target=await until(async()=>{const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();return targets.find(t=>t.type==='page'&&t.url.startsWith(connection.url));});
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const r=JSON.parse(event.data);const task=pending.get(r.id);if(task){pending.delete(r.id);r.error?task.reject(new Error(r.error.message)):task.resolve(r.result);}});
 await until(()=>evaluate('document.getElementById("brand-menu-toggle") && snapshot?.projects.length===1'));
 const values=await evaluate(`(()=>{document.getElementById('brand-menu-toggle').click();return {icon:getComputedStyle(document.querySelector('.brand-icon')).width,title:getComputedStyle(document.querySelector('.brand-name')).fontSize,open:!document.getElementById('brand-menu').hidden,quit:document.getElementById('quit-app').textContent,project:snapshot.projects[0].name};})()`);
 assert.equal(values.icon,'34px');assert.equal(values.title,'24px');assert.equal(values.open,true);assert.equal(values.quit,'Quit');assert.equal(values.project,'UI connection verification');
 const config=await evaluate('window.desktop.connection()');assert.ok(config.instructions.includes(JSON.stringify(home)));
 const saved=await evaluate('window.desktop.saveConnection()');assert.ok(fs.existsSync(saved));
 await until(()=>fs.existsSync(path.join(env.CODEX_HOME,'config.toml')));
 const registered=fs.readFileSync(path.join(env.CODEX_HOME,'config.toml'),'utf8');
 assert.ok(registered.includes('nozeomics'));assert.ok(registered.includes(JSON.stringify(home)));
 await evaluate('document.getElementById("ai-connection").click();true');
 await until(()=>evaluate('document.getElementById("modal").open && document.querySelector(".ai-connection-dialog p").textContent==="Codex configured"'));
 await evaluate('document.getElementById("modal").close();document.getElementById("reload-app").click();true');
 await until(()=>evaluate('snapshot?.projects[0]?.name==="UI connection verification"'));
 assert.equal(fs.readFileSync(path.join(env.CODEX_HOME,'config.toml'),'utf8'),registered);
 await evaluate('document.getElementById("brand-menu-toggle").click();document.getElementById("quit-app").click();true');
 await until(()=>app.exitCode!==null);
 await until(async()=>{try{await fetch(connection.url+'/health');return false;}catch{return true;}});
 console.log('PASS: first-launch Codex registration, AI connection menu/status, MCP shared state, Reload without duplicate settings, connection export and Quit.');
}finally{
 socket?.close();await client?.close();
 if(app.exitCode===null)spawn(exe,['--quit'],{env,windowsHide:true,stdio:'ignore'});
}
