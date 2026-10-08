const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');

function createAIConnection({root,home,config,env=process.env}){
 const codexHome=env.CODEX_HOME||path.join(env.USERPROFILE||os.homedir(),'.codex');
 let busy=null;
 function setup(mode='connect'){
  if(busy)return busy;
  busy=new Promise(resolve=>{
   const child=spawn(path.join(root,'runtime','python','python.exe'),['-m','backend.ai_connection'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...env,PYTHONUTF8:'1'}});
   let output='',finished=false;
   const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);resolve(result);};
   const timer=setTimeout(()=>{child.kill();finish({configured:false,error:'Connection setup timed out. Please try again.'});},10000);
   child.on('error',()=>finish({configured:false,error:'Could not start connection setup.'}));
   child.stdout.on('data',chunk=>{output+=chunk.toString();});
   child.on('close',()=>{try{finish(JSON.parse(output));}catch{finish({configured:false,error:'Could not complete connection setup.'});}});
   child.stdin.on('error',()=>{});
   child.stdin.end(JSON.stringify({mode,home,config_path:path.join(codexHome,'config.toml'),server:config().mcpServers.nozeomics}));
  }).finally(()=>{busy=null;});
  return busy;
 }
 return {setup};
}
module.exports={createAIConnection};
