/* Debounce sample changes; graph and panel edits never trigger a model fit. */
let autoProject=null,autoSeen=new Map(),autoPending=new Map(),autoDeadline=0,autoStarting=false,autoLatest=new Map();
const autoBox=document.createElement('div');autoBox.id='auto-analysis';autoBox.hidden=true;autoBox.setAttribute('role','status');autoBox.innerHTML='<span></span><progress max="3" value="0" aria-label="Automatic significance update"></progress>';document.querySelector('.subhead').append(autoBox);
function observeAutoAnalysis(s){
 const p=s.project;if(p?.id!==autoProject||p?.stage!=='analysis'){autoProject=p?.id;autoSeen.clear();autoPending.clear();autoLatest.clear();autoDeadline=0;}if(p?.stage!=='analysis')return;
 for(const c of Object.values(p?.comparisons||{})){const key=JSON.stringify([...c.included].sort());if(autoLatest.has(c.id)&&autoLatest.get(c.id)!==key)continue;if(autoSeen.has(c.id)&&autoSeen.get(c.id)!==key){autoPending.set(c.id,key);if(autoDeadline<=Date.now())autoDeadline=Date.now()+3000;}if(autoPending.get(c.id)===key&&key===JSON.stringify([...(c.result_selection||c.samples||[])].sort()))autoPending.delete(c.id);autoSeen.set(c.id,key);}
 paintAutoAnalysis();
}
function paintAutoAnalysis(){
 const running=(snapshot?.jobs||[]).filter(j=>j.project_id===autoProject&&j.kind==='differential'&&['queued','running'].includes(j.status));
 if(window.analysisPCALoading){const failed=(snapshot?.jobs||[]).filter(j=>j.project_id===autoProject&&j.kind==='pca').at(-1);if(failed?.status==='failed'&&Date.parse(failed.started||failed.created)>window.analysisPCAStarted){window.analysisPCALoading=null;setAnalysisLoading(false);}}
 const busy=!!running.length||autoStarting;if(busy){if(!window.analysisWasBusy)window.analysisBusySince=Date.now();setAnalysisLoading(true);window.analysisWasBusy=true;}else if(window.analysisWasBusy){window.analysisWasBusy=false;const failed=(snapshot?.jobs||[]).some(j=>j.project_id===autoProject&&j.kind==='differential'&&j.status==='failed'&&Date.parse(j.completed||j.created)>window.analysisBusySince);if(failed){window.analysisRecalcActive=false;setAnalysisLoading(false);}}
 if(!busy&&window.analysisLoadedDataRevision!==undefined&&window.analysisLoadedDataRevision===snapshot?.project?.data_revision)setAnalysisLoading(false);
 $('viewer').contentWindow?.postMessage({type:'recalc-countdown',deadline:autoPending.size&&!busy?autoDeadline:0},location.origin);
 autoBox.hidden=!autoPending.size&&!running.length&&!autoStarting;const label=autoBox.querySelector('span'),bar=autoBox.querySelector('progress');
 if(autoPending.size&&!autoStarting){const left=Math.max(0,autoDeadline-Date.now());label.textContent='Significance updates in '+Math.ceil(left/1000)+'s';bar.value=(3000-left)/1000;}else{label.textContent=running.length?'Updating significance · '+running.map(j=>j.phase).join(' · '):'Starting significance update…';bar.removeAttribute('value');}
}
async function launchAutoAnalysis(){
 if(autoStarting||!autoPending.size||Date.now()<autoDeadline)return;let launched=0;autoStarting=true;window.analysisRecalcActive=true;window.analysisRecalcBaseRevision=snapshot?.project?.data_revision;setAnalysisLoading(true);
 try{for(const [cid,key]of [...autoPending]){let s=await nzApi('state',{},true);if(s.project?.id!==autoProject){autoPending.clear();break;}const c=s.project.comparisons[cid];if(!c){autoPending.delete(cid);continue;}if(JSON.stringify([...c.included].sort())!==key){observeAutoAnalysis(s);break;}
 try{await nzApi('start_analysis',{comparison_id:cid,kind:'differential',base_revision:s.revision,request_id:crypto.randomUUID()});launched++;if(autoPending.get(cid)===key)autoPending.delete(cid);}catch(e){if(e.code==='revision_conflict'){autoDeadline=Date.now()+500;break;}autoPending.delete(cid);toast('Significance update: '+e.message);}}
 await refresh();}catch(e){autoDeadline=Date.now()+2000;toast(e.message);}finally{autoStarting=false;if(!launched){window.analysisRecalcActive=false;setAnalysisLoading(false);}paintAutoAnalysis();}
}
window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===$('viewer').contentWindow&&e.data?.type==='sample-selection-changed'){autoDeadline=Date.now()+3000;const selections=e.data.selections||{};for(const [cid,ids]of Object.entries(selections)){const c=snapshot?.project?.comparisons?.[cid];if(!c)continue;const key=JSON.stringify([...ids].sort()),baseline=JSON.stringify([...(c.result_selection||c.samples||[])].sort());autoLatest.set(cid,key);if(key===baseline)autoPending.delete(cid);else autoPending.set(cid,key);}paintAutoAnalysis();}});
setInterval(()=>{paintAutoAnalysis();launchAutoAnalysis();},100);

function keepRecalculationLoading(){if(!window.analysisRecalcActive)return false;const busy=autoStarting||(snapshot?.jobs||[]).some(j=>j.project_id===autoProject&&j.kind==='differential'&&['queued','running'].includes(j.status));const revision=snapshot?.project?.data_revision;if(!busy&&revision!==window.analysisRecalcBaseRevision&&window.analysisLoadedDataRevision===revision){window.analysisRecalcActive=false;return false;}return true;}
