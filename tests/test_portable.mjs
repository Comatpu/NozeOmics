import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire('C:/Users/nojae/OneDrive/Desktop/노제/NozeDock v3/frontend/package.json');
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const exe=path.join(root,'.build/portable/NozeOmics.exe');
const home=path.join(root,'.local','portable-check-'+Date.now());
const env={...process.env,NOZEOMICS_HOME:home};
const client=new Client({name:'single-exe-smoke-test',version:'1'},{capabilities:{}});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(name,args={}){const r=await client.callTool({name:'nozeomics_'+name,arguments:args});const value=JSON.parse(r.content[0].text);assert.equal(!!r.isError,false,JSON.stringify(value));return value;}
try{
 await client.connect(new StdioClientTransport({command:exe,args:['--mcp'],env}));
 assert.equal((await client.listTools()).tools.length,16);
 let s=await call('get_state');assert.equal(s.projects.length,0);
 await call('open_project',{name:'Single EXE verification',base_revision:s.revision});
 const stage=await call('prepare_import');
 const columns=Array.from({length:8},(_,i)=>'S'+i),file=path.join(stage.staging_path,'counts.tsv');
 fs.writeFileSync(file,'gene\t'+columns.join('\t')+'\n'+Array.from({length:120},(_,g)=>'G'+g+'\t'+columns.map((_,i)=>Math.round((100+g*4+(g*i*13)%97)*(g<10&&i>=4?4:1))).join('\t')).join('\n'));
 const samples=columns.map((id,i)=>({id,source_column:id,subject:String(i%4),tissue:'liver',biological_replicate:true,evidence:[{source:file,locator:'header',value:id}]}));
 s=await call('get_state');const d=await call('import_dataset',{path:file,organism:'mouse',recipe:{gene_column:'gene',unit:'raw_count',identifiers:'symbol'},samples,base_revision:s.revision});
 s=await call('get_state');const c=await call('configure_comparison',{dataset_id:d.dataset.id,groups:Object.fromEntries(columns.map((id,i)=>[id,i<4?'Group A':'Group B'])),blocking_fields:['subject'],base_revision:s.revision});
 s=await call('get_state');const r=await call('start_analysis',{comparison_id:c.comparison.id,kind:'differential',base_revision:s.revision,request_id:'portable-'+Date.now()});
 let job;for(let i=0;i<100;i++){job=await call('get_job',{job_id:r.job.id});if(!['queued','running'].includes(job.status))break;await delay(150);}
 assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.applied,true);
 const connection=JSON.parse(fs.readFileSync(path.join(home,'connection.json'),'utf8'));assert.equal(connection.home,home);
 const html=await (await fetch(connection.url)).text();assert.ok(html.includes('/assets/Omics.png'));assert.ok(html.includes('id="quit-app"'));
 console.log('PASS: single EXE unpacking, hidden auto-start, 16 MCP tools, shared state, imported counts, bundled Python/R analysis, desktop HTML.');
}finally{
 await client.close();
 if(fs.existsSync(path.join(home,'connection.json')))spawn(exe,['--quit'],{env,windowsHide:true,stdio:'ignore'});
 for(let i=0;i<100&&fs.existsSync(path.join(home,'connection.json'));i++)await delay(150);
}
