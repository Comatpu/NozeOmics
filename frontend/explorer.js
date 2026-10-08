(async()=>{
const data=await api('payload',{},true), genes=data.genes, datasets=data.datasets;
for(const id of ['nz-cutoff-minus','nz-cutoff-value','nz-cutoff-plus'])document.querySelector('.nz-cutoff-steps').append(document.getElementById(id));
const sampleMetadata=new Map();(async()=>{for(let offset=0;;offset+=100){const result=await api('get_intake',{offset,limit:100});if(result.project_id!==data.project?.id)return;for(const entry of result.entries||[])for(const sample of entry.samples||[])sampleMetadata.set(sample.gsm,sample);if(!(result.entries||[]).some(e=>e.total_samples>offset+100))break;}})().catch(()=>{});
const palette=['#2563a5','#dc6b26','#208b62','#bd3e55','#8159b5','#0296ad','#9b6d15','#c4559f'];
const highlightPalette=['#d64713','#6d28a8','#bb184c','#1260bf','#b3540c','#bc1c66','#1e4bb0','#08765b'];
const cutoffValues=[.01,.02,.03,.04,.05,.10,.15,.20,.25,.30,.35,.40,.45,.50];
async function api(method,args={},read=false){const response=await fetch('/api/'+method,{signal:AbortSignal.timeout(15000),method:read?'GET':'POST',headers:{Authorization:'Bearer '+NOZEOMICS.token,'Content-Type':'application/json'},body:read?undefined:JSON.stringify(args)});const result=await response.json();if(!response.ok){const error=new Error(result.error?.message||'Request failed');error.code=result.error?.code;throw error;}return result;}
const originalSignificance=datasets.map(d=>JSON.parse(JSON.stringify(d.significance||[])));
const state={checked:datasets.map(d=>d.samples.map(s=>d.included.includes(s.id))),modes:datasets.map(()=> 'mean'),collapsed:datasets.map(()=>true),hover:null,hoverSample:null,hoverGene:null,zoom:1,hideNonsig:false,cutoffIndex:4,cutoff:.05,significanceMetric:'adj_p',showType:'mean',graphType:'trend',maSearchName:null,maDatasetIndex:0,trendModes:null,maViewport:{scale:1,panX:0,panY:0},heatmapScale:1,hiddenGenes:new Set(),recalculated:datasets.map(()=>false),recalcSelection:datasets.map(()=>null),statsDirty:datasets.map(()=>false),statsRunning:false};
const side=document.getElementById('nz-side'),graph=document.getElementById('nz-graph'),scroll=document.getElementById('nz-scroll'),yAxisLayer=document.getElementById('nz-y-axis'),geneList=document.getElementById('nz-gene-list'),geneTitle=document.getElementById('nz-gene-title'),footer=document.getElementById('nz-footer'),statBadge=document.getElementById('nz-stat-badge'),recalculateButton=document.getElementById('nz-recalculate'),significanceToggle=document.getElementById('nz-significance-toggle');
let updateSampleOverlay=()=>{},updateGeneHighlight=()=>{},highlightHeatmapGene=()=>{},highlightHeatmapSample=()=>{};
const color=i=>palette[i%palette.length],highlightColor=i=>highlightPalette[i%highlightPalette.length], svg=(tag,attrs={})=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(cls==='nz-tooltip')e.id='nz-tip';if(text!==undefined)e.textContent=text;return e;};
const finite=x=>typeof x==='number'&&Number.isFinite(x),fmt=x=>finite(x)?Number(x).toFixed(3):'—';
function summary(d,di,gi){if(state.hideNonsig&&sigInfo(d,gi).status==='not_significant')return null;const a=[],b=[],members=[];d.samples.forEach((s,si)=>{if(!state.checked[di][si])return;const raw=d.values[gi][si];if(!finite(raw))return;const log=d.prelogged?raw:(raw>=0?Math.log2(raw+data.log_offset):NaN);if(!finite(log))return;(s.group==='Group A'?a:b).push(log);members.push({sample:s,raw,log,group:s.group,si});});if(!a.length||!b.length)return null;const mean=x=>x.reduce((p,c)=>p+c,0)/x.length, ma=mean(a),mb=mean(b);return {mean:!state.statsDirty[di]&&d.statistics_current&&finite(d.original_effects[gi])?d.original_effects[gi]:mb-ma,ave:!state.statsDirty[di]&&d.statistics_current&&finite(d.original_aves?.[gi])?d.original_aves[gi]:mean([...a,...b]),members,ma,mb,nA:a.length,nB:b.length};}
function applySideSampleHighlight(){side.querySelectorAll('.nz-sample').forEach(row=>{const active=state.hoverSample&&Number(row.dataset.di)===state.hoverSample.di&&Number(row.dataset.si)===state.hoverSample.si;row.classList.toggle('nz-active',!!active);row.classList.toggle('nz-dim',!!state.hoverSample&&!active);});}
function setSampleHover(di,si){const same=state.hoverSample&&state.hoverSample.di===di&&state.hoverSample.si===si;state.hoverSample=same?state.hoverSample:{di,si};applySideSampleHighlight();if(state.graphType==='heatmap')highlightHeatmapSample(si);else if(state.graphType==='trend')renderChart();else if(state.graphType==='pca'){pcaHover=datasets[di].samples[si].id;drawPCA();}}
function clearSampleHover(di,si){if(!state.hoverSample||state.hoverSample.di!==di||state.hoverSample.si!==si)return;state.hoverSample=null;applySideSampleHighlight();if(state.graphType==='heatmap')highlightHeatmapSample(null);else if(state.graphType==='trend')renderChart();else if(state.graphType==='pca'){pcaHover=null;drawPCA();}}
function showDotSample(event,di,member,gi,s){state.hoverSample={di,si:member.si};applySideSampleHighlight();updateSampleOverlay(state.hoverSample);showTip(event,di,member,gi,s);}
function clearDotSample(){hideTip();state.hoverSample=null;applySideSampleHighlight();updateSampleOverlay(null);}
function applyGenePanelHighlight(){geneList.querySelectorAll('.nz-gene-row[data-gi]').forEach(row=>{const active=state.hoverGene!==null&&Number(row.dataset.gi)===state.hoverGene;row.classList.toggle('nz-active',active);row.classList.toggle('nz-dim',state.hoverGene!==null&&!active);});}
function setGeneHover(gi){if(state.hoverGene===gi)return;state.hoverGene=gi;applyGenePanelHighlight();if(state.graphType==='ma')scheduleMADraw();else if(state.graphType==='heatmap')highlightHeatmapGene(gi);else updateGeneHighlight(gi);}
function clearGeneHover(gi){if(state.hoverGene!==gi)return;state.hoverGene=null;applyGenePanelHighlight();if(state.graphType==='ma')scheduleMADraw();else if(state.graphType==='heatmap')highlightHeatmapGene(null);else updateGeneHighlight(null);}
function selectionMatches(di,snapshot){return Array.isArray(snapshot)&&snapshot.length===state.checked[di].length&&snapshot.every((value,si)=>Boolean(value)===Boolean(state.checked[di][si]));}
function updateStatisticsState(di){const d=datasets[di];state.statsDirty[di]=!d.statistics_current||!d.samples.every((s,si)=>state.checked[di][si]===d.included.includes(s.id));updateStatisticsBadge();}
function updateStatisticsBadge(){statBadge.className='nz-stat-badge';if(state.statsRunning){statBadge.textContent='Recalculating';statBadge.classList.add('running');return;}const visible=datasets.map((_,di)=>di).filter(di=>state.graphType!=='trend'?di===state.maDatasetIndex:state.modes[di]!=='hidden');if(visible.some(di=>state.statsDirty[di])){statBadge.textContent='Statistics outdated';statBadge.classList.add('outdated');return;}if(visible.some(di=>state.recalculated[di])){statBadge.textContent='Recalculated';statBadge.classList.add('recalculated');}else statBadge.textContent='Current';}
function metricLabel(){return state.significanceMetric==='p_value'?'P.Value':'adj.P.Val';}
function rollbackDataset(di){datasets[di].significance=JSON.parse(JSON.stringify(originalSignificance[di]));datasets[di].ma_recalculated_points=null;state.checked[di]=state.checked[di].map(()=>true);state.recalculated[di]=false;state.recalcSelection[di]=null;state.statsDirty[di]=false;state.hoverSample=null;}
function groupDisplayLabel(d,di,group){
 const selected=d.samples.filter((s,si)=>s.group===group&&state.checked[di][si]);
 const signatures=new Set(selected.map(s=>s.condition_fields?.length?JSON.stringify([...s.condition_fields].map(v=>v.toLowerCase().trim()).sort()):(s.name||s.column||'').replace(/(?:replicate|rep|repl)[_ -]*\d+/gi,'').replace(/[_ -]\d+$/,'').trim()));
 return signatures.size>1?(group==='Group A'?'Control groups':'Treated groups'):(group==='Group A'?(d.a_label||group):(d.b_label||group));
}
function renderSide(){
  side.replaceChildren();
  datasets.forEach((d,di)=>{
    const block=el('div','nz-dataset'),head=el('div','nz-dataset-head'),enabled=el('input'),chip=el('i','nz-color'),disclosure=el('button','nz-disclosure',state.collapsed[di]?'▸':'▾');
    enabled.type='checkbox';enabled.className='nz-gse-toggle';enabled.checked=state.graphType!=='trend'?state.maDatasetIndex===di:state.modes[di]!=='hidden';enabled.onchange=()=>{if(state.graphType==='trend'&&!enabled.checked&&state.modes.filter(mode=>mode!=='hidden').length<=1){enabled.checked=true;return;}if(state.graphType!=='trend'){if(state.graphType==='pca'&&state.maDatasetIndex!==di){document.getElementById('nz-pca-top').value='500';pcaViewport.initial=true;}state.collapsed=state.collapsed.map((_,index)=>index===di?state.collapsed[index]:true);state.hoverSample=null;pcaHover=null;pcaSelected=null;state.maDatasetIndex=di;state.lastSelectedDataset=d.dataset_id;state.modes=datasets.map((_,index)=>index===di?state.showType:'hidden');state.maViewport={...state.maViewport,scale:1,panX:0,panY:0,initialRight:true};state.heatmapScale=1;state.maSearchName=null;document.getElementById('nz-ma-gene-query').value='';maHoverPointName=null;maHoverGene=null;state.hoverGene=null;if(state.graphType==='pca')ensurePCA(di,Number(document.getElementById('nz-pca-top').value));}else{state.modes[di]=enabled.checked?state.showType:'hidden';if(enabled.checked){state.maDatasetIndex=di;state.lastSelectedDataset=d.dataset_id;}}if(state.hoverSample?.di===di)state.hoverSample=null;renderAll();};
    chip.style.background=color(di);
    const nA=d.samples.reduce((count,s,si)=>count+(s.group==='Group A'&&state.checked[di][si]?1:0),0),nB=d.samples.reduce((count,s,si)=>count+(s.group==='Group B'&&state.checked[di][si]?1:0),0),title=el('strong','',d.gse||d.label.match(/GSE\d+/)?.[0]||d.label);

    head.onmouseenter=()=>{document.querySelector('.nz-study-tooltip')?.remove();const tip=el('div','nz-study-tooltip'),line=el('div','nz-study-tooltip-head');line.append(el('strong','',d.gse||d.label),el('span','','Control '+nA+', Treated '+nB));tip.append(line,el('div','nz-study-tooltip-title',d.study_title||d.label));document.body.append(tip);const r=head.getBoundingClientRect();tip.style.left=Math.max(12,Math.min(r.right+10,innerWidth-tip.offsetWidth-12))+'px';tip.style.top=Math.max(12,Math.min(r.top,innerHeight-tip.offsetHeight-12))+'px';};head.onmouseleave=()=>document.querySelector('.nz-study-tooltip')?.remove();
    disclosure.onclick=event=>{event.stopPropagation();state.collapsed[di]=!state.collapsed[di];renderSide();};
    const toggle=el('label','nz-dataset-toggle');toggle.append(enabled,chip,title);head.append(toggle,disclosure);head.onclick=event=>{if(event.target.closest('.nz-disclosure')||enabled.disabled)return;event.preventDefault();enabled.checked=state.graphType==='trend'?state.modes[di]==='hidden':state.maDatasetIndex!==di;enabled.onchange();};block.append(head);
    if(!state.collapsed[di]){for(const group of ['Group A','Group B']){block.append(el('div','nz-group',group==='N/A'?'Other samples':groupDisplayLabel(d,di,group)));d.samples.forEach((s,si)=>{if(s.group!==group)return;const row=el('label','nz-sample'),box=el('input');row.dataset.di=di;row.dataset.si=si;const excludedByRecalculation=state.recalculated[di]&&Array.isArray(state.recalcSelection[di])&&!state.recalcSelection[di][si];row.classList.toggle('nz-excluded',excludedByRecalculation);box.type='checkbox';box.checked=state.checked[di][si];box.onchange=()=>{state.checked[di][si]=box.checked;notifySelectionChange();if(!box.checked&&state.hoverSample?.di===di&&state.hoverSample?.si===si)state.hoverSample=null;updateStatisticsState(di);renderAll();};row.onmouseenter=()=>setSampleHover(di,si);row.onmouseleave=()=>clearSampleHover(di,si);const label=s.gsm||s.name||s.column,text=el('span','nz-sample-name',label);text.title=(s.name||'')+' | '+s.column;row.append(box);if(excludedByRecalculation)row.append(el('span','nz-excluded-check','×'));row.append(text);block.append(row);});}}
    side.append(block);
  });
  if(state.graphType!=='trend')for(const item of data.unsupported_datasets||[]){const block=el('div','nz-dataset'),head=el('div','nz-dataset-head'),box=el('input'),title=el('strong','',item.label),plotName=state.graphType==='heatmap'?'heatmap':'MA plot';box.type='checkbox';box.disabled=true;title.title='Data does not support '+plotName+': '+item.input_data;head.append(box,title);block.append(head,el('div','nz-ma-disabled-note','Data does not support '+plotName+' ('+item.input_data+').'));side.append(block);}
  applySideSampleHighlight();
  updateStatisticsBadge();
}
let geneDragIndex=null,toastTimer=null,panelEditBusy=false;
function showToast(message){const toast=document.getElementById('nz-toast');toast.textContent=message;toast.style.display='block';if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.style.display='none';},2300);}
function moveEntry(list,from,to){const [value]=list.splice(from,1);list.splice(to,0,value);}
function restoreHiddenNames(names){state.hiddenGenes=new Set(genes.map((gene,gi)=>names.has(gene.toLowerCase())?gi:null).filter(gi=>gi!==null));}
function reorderGene(from,to){if(from===to||from<0||to<0||from>=genes.length||to>=genes.length)return;const hidden=new Set([...state.hiddenGenes].map(gi=>genes[gi]?.toLowerCase()));moveEntry(genes,from,to);datasets.forEach(d=>{for(const key of ['values','codes','original_effects','original_aves','significance'])moveEntry(d[key],from,to);});originalSignificance.forEach(list=>moveEntry(list,from,to));restoreHiddenNames(hidden);state.hoverGene=null;maHoverGene=null;rebuildGeneIndex();renderAll();}
function removeGene(gi){if(gi<0||gi>=genes.length)return;const hidden=new Set([...state.hiddenGenes].map(index=>genes[index]?.toLowerCase()));genes.splice(gi,1);datasets.forEach(d=>{for(const key of ['values','codes','original_effects','original_aves','significance'])d[key].splice(gi,1);});originalSignificance.forEach(list=>list.splice(gi,1));restoreHiddenNames(hidden);state.hoverGene=null;maHoverGene=null;rebuildGeneIndex();renderAll();}
async function addGene(name){
  const key=name.toLowerCase();if(geneIndexByName.has(key)){showToast(name+' is already in the gene panel.');return;}
  if(panelEditBusy)return;panelEditBusy=true;showToast('Adding '+name+'…');
  try{
    await Promise.all(datasets.map(loadMA));
    if(geneIndexByName.has(key))return;
    const records=datasets.map(d=>{const index=d.ma_index.get(key),original=index===undefined?null:d.ma_points[index],values=index===undefined?Array(d.samples.length).fill(null):d.ma_matrix[index],recalculated=d.ma_recalculated_points?.find(point=>point[0].toLowerCase()===key),active=state.recalculated[datasets.indexOf(d)]&&recalculated?recalculated:original;const sig=point=>point?{p_value:point[3],adj_p:point[4],status:finite(point[4])&&point[4]<.05?'pass':(finite(point[4])?'not_significant':'unavailable')}:{p_value:null,adj_p:null,status:'missing'};return {values,codes:null,effect:active?.[2]??null,ave:active?.[1]??null,significance:sig(active),originalSignificance:sig(original)};});
    if(records.every(record=>record.originalSignificance.status==='missing')){showToast('Gene not found in the loaded datasets.');return;}
    genes.push(name);datasets.forEach((d,di)=>{const record=records[di];d.values.push(record.values);d.codes.push(record.codes);d.original_effects.push(record.effect);d.original_aves.push(record.ave);d.significance.push(record.significance);originalSignificance[di].push(record.originalSignificance);});
    rebuildGeneIndex();state.hoverGene=genes.length-1;maHoverGene=state.hoverGene;renderAll();showToast(name+' added to the gene panel.');
  }catch(error){showToast('Could not add gene: '+(error.message||error));}
  finally{panelEditBusy=false;}
}
function renderGenePanel(){if(state.graphType==='pca'){renderSamplePanel();return;}
  geneList.replaceChildren();
  const allRow=el('label','nz-gene-row nz-gene-all'),allBox=el('input'),allText=el('span','','All');
  allBox.type='checkbox';allBox.checked=genes.length>0&&state.hiddenGenes.size===0;allBox.indeterminate=state.hiddenGenes.size>0&&state.hiddenGenes.size<genes.length;
  allBox.onchange=()=>{state.hiddenGenes=allBox.checked?new Set():new Set(genes.map((_,gi)=>gi));state.hoverGene=null;renderGenePanel();renderActiveGraph();};allRow.append(allBox,allText);geneList.append(allRow);
  genes.forEach((gene,gi)=>{const row=el('div','nz-gene-row'),toggle=el('label','nz-gene-toggle'),box=el('input'),text=el('span','',gene),remove=el('button','nz-gene-remove','×');row.dataset.gi=gi;row.draggable=true;box.type='checkbox';box.checked=!state.hiddenGenes.has(gi);box.setAttribute('aria-label','Show '+gene);box.onchange=()=>{state.hoverGene=null;if(box.checked)state.hiddenGenes.delete(gi);else state.hiddenGenes.add(gi);renderActiveGraph();renderGenePanel();};row.onmouseenter=()=>setGeneHover(gi);row.onmouseleave=()=>clearGeneHover(gi);text.title=gene;remove.type='button';remove.title='Remove '+gene;remove.setAttribute('aria-label','Remove '+gene);remove.onclick=event=>{event.stopPropagation();removeGene(gi);};row.ondragstart=event=>{geneDragIndex=gi;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(gi));};row.ondragover=event=>{event.preventDefault();row.classList.add('nz-drag-over');};row.ondragleave=()=>row.classList.remove('nz-drag-over');row.ondrop=event=>{event.preventDefault();row.classList.remove('nz-drag-over');if(geneDragIndex!==null)reorderGene(geneDragIndex,gi);geneDragIndex=null;};row.ondragend=()=>{geneDragIndex=null;row.classList.remove('nz-drag-over');};toggle.append(box,text);row.append(toggle,remove);geneList.append(row);});
  geneTitle.textContent='Genes ('+(genes.length-state.hiddenGenes.size)+'/'+genes.length+')';applyGenePanelHighlight();
}
function sigInfo(d,gi){if(state.statsDirty[datasets.indexOf(d)])return {p_value:null,adj_p:null,status:'unavailable'};const source=(d.significance&&d.significance[gi])||{p_value:null,adj_p:null,status:'unavailable'};if(source.status==='missing')return source;const value=source[state.significanceMetric];if(!finite(value))return {...source,status:'unavailable'};return {...source,status:Number(value)<=state.cutoff?'pass':'not_significant'};}
function appendSignificance(tip,d,gi){const info=sigInfo(d,gi),raw=finite(info.p_value)?Number(info.p_value).toExponential(3):'unavailable',adjusted=finite(info.adj_p)?Number(info.adj_p).toExponential(3):'unavailable',label=metricLabel();tip.append(el('div',state.significanceMetric==='p_value'&&info.status!=='pass'?'nz-tip-warning':'','P.Value: '+raw));tip.append(el('div',state.significanceMetric==='adj_p'&&info.status!=='pass'?'nz-tip-warning':'','adj.P.Val: '+adjusted));if(info.status==='not_significant')tip.append(el('div','nz-tip-warning','Warning: '+label+' > '+state.cutoff.toFixed(2)));else if(info.status==='unavailable')tip.append(el('div','nz-tip-warning','Warning: '+label+' unavailable'));}
function tipHeading(tip,gene,accession){const head=el('div','nz-tip-heading');head.append(el('strong','',gene),el('span','',accession));tip.append(head);}
function tipFields(tip,fields){const list=el('dl','nz-tip-fields');for(const [label,value]of fields){list.append(el('dt','',label+':'),el('dd','',value));}tip.append(list);}
function positionPlotTip(tip,event){document.body.append(tip);tip.style.display='block';tip.style.left=Math.max(8,Math.min(innerWidth-tip.offsetWidth-8,event.clientX+15))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,event.clientY+12))+'px';}
function fillPointTip(tip,label,gene,effect,ave,raw,adjusted,extra){
 tip.replaceChildren();if(extra?.ma)tipHeading(tip,gene,'');else tipHeading(tip,extra?.gsm||label.match(/GSE\d+/)?.[0]||label,gene);
 tipFields(tip,[['log2FC',fmt(effect)],['AveExpr',fmt(ave)],['P.value',finite(raw)?Number(raw).toExponential(3):'unavailable'],['adj.P.Val',finite(adjusted)?Number(adjusted).toExponential(3):'unavailable']]);
 const value=state.significanceMetric==='p_value'?raw:adjusted;
 if(!finite(value))tip.append(el('div','nz-tip-warning','Warning: '+metricLabel()+' unavailable'+(extra?.outdated?' (updating)':'')));
 else if(value>state.cutoff)tip.append(el('div','nz-tip-warning','Warning: '+metricLabel()+' > '+state.cutoff.toFixed(2)));
 if(extra?.outdated)tip.append(el('div','nz-tip-warning','Sample selection changed · updating significance'));
}

function showTip(event,di,member,gi,s){const tip=document.getElementById('nz-tip'),d=datasets[di],info=sigInfo(d,gi);fillPointTip(tip,d.label,genes[gi],s.mean,s.ave,info.p_value,info.adj_p,{gsm:member.sample.gsm||member.sample.name||member.sample.column,group:member.group,outdated:state.statsDirty[di]});positionPlotTip(tip,event);state.hover={di,gi,ave:s.ave};updateFooter();}
function showMeanTip(event,di,gi,s){const tip=document.getElementById('nz-tip'),d=datasets[di],info=sigInfo(d,gi);fillPointTip(tip,d.label,genes[gi],s.mean,s.ave,info.p_value,info.adj_p,{outdated:state.statsDirty[di]});positionPlotTip(tip,event);state.hover={di,gi,ave:s.ave};updateFooter();}
function hideTip(){const tip=document.getElementById('nz-tip');if(tip)tip.style.display='none';state.hover=null;updateFooter();}
function updateFooter(){const gene=state.hover?genes[state.hover.gi]:'—';let text='Gene: '+gene+' · ';if(state.hover){text+=datasets[state.hover.di].label+' AveExpr: '+fmt(state.hover.ave);}else{text+='Hover over a sample dot for GSM and expression values.';}footer.textContent=text+'  |  Individual dots are centered on the current Group A log-expression mean.';}
function showSignificanceTip(event,d,gi){const tip=document.getElementById('nz-tip');tip.replaceChildren();tip.append(el('div','',d.label));appendSignificance(tip,d,gi);positionPlotTip(tip,event);}
function addSignificanceMarker(chart,d,di,gi,cx){const info=sigInfo(d,gi);if(info.status==='pass'||info.status==='missing'||(state.hideNonsig&&info.status==='not_significant'))return;const warningIndices=datasets.map((candidate,index)=>({candidate,index,info:sigInfo(candidate,gi)})).filter(item=>state.modes[item.index]!=='hidden'&&['not_significant','unavailable'].includes(item.info.status)&&!(state.hideNonsig&&item.info.status==='not_significant')).map(item=>item.index),rank=warningIndices.indexOf(di);if(rank<0)return;const perRow=3,row=Math.floor(rank/perRow),rowStart=row*perRow,rowCount=Math.min(perRow,warningIndices.length-rowStart),column=rank%perRow,iconX=cx+(column-(rowCount-1)/2)*14,iconY=14+row*15,iconColor=info.status==='not_significant'?color(di):'#7a8795';const icon=svg('circle',{cx:iconX,cy:iconY,r:6.5,fill:iconColor,stroke:'#fff','stroke-width':1.5});icon.style.cursor='help';icon.onmouseenter=e=>showSignificanceTip(e,d,gi);icon.onmousemove=e=>showSignificanceTip(e,d,gi);icon.onmouseleave=hideTip;chart.append(icon);const mark=svg('text',{x:iconX,y:iconY+4,'text-anchor':'middle',fill:'#fff','font-size':11,'font-weight':'bold','pointer-events':'none'});mark.textContent=info.status==='not_significant'?'!':'?';chart.append(mark);}
function visibleGeneIndices(){return genes.map((_,gi)=>gi).filter(gi=>!state.hiddenGenes.has(gi));}
function renderChart(){
  graph.replaceChildren();
  const geneIndices=visibleGeneIndices(),shownCount=geneIndices.length;
  const baseWidth=Math.max(1060,Math.max(1,shownCount)*105+170),width=Math.max(760,Math.round(baseWidth*.7));
  const height=555,left=75,right=35,top=58,bottom=116,plotW=width-left-right,plotH=height-top-bottom;
  graph.style.width=width+'px';
  const chart=svg('svg',{width,height,viewBox:`0 0 ${width} ${height}`});
  const trendDots=[];const summaries=datasets.map((d,di)=>genes.map((_,gi)=>summary(d,di,gi))),yy=[0];
  datasets.forEach((d,di)=>{if(state.modes[di]==='hidden')return;geneIndices.forEach(gi=>{const s=summaries[di][gi];if(!s)return;yy.push(s.mean);s.members.forEach(m=>yy.push(m.log-s.ma));});});

  const low=Math.min(...yy),high=Math.max(...yy),span=Math.max(.5,high-low),min=low-span*.12,max=high+span*.12;
  const slot=plotW/Math.max(1,shownCount),x=position=>left+(position+.5)*slot,y=value=>top+(max-value)*plotH/(max-min);
  for(let k=0;k<=5;k++){const value=min+(max-min)*k/5,cy=y(value);chart.append(svg('line',{x1:left,y1:cy,x2:width-right,y2:cy,stroke:'#e3eaf2'}));const t=svg('text',{x:left-9,y:cy+4,'text-anchor':'end',fill:'#63758b','font-size':11});t.textContent=value.toFixed(2);chart.append(t);}
  chart.append(svg('line',{x1:left,y1:y(0),x2:width-right,y2:y(0),stroke:'#547595','stroke-width':1.4}));
  geneIndices.forEach((gi,position)=>{const gene=genes[gi],gx=x(position),tick=svg('line',{x1:gx,y1:height-bottom,x2:gx,y2:height-bottom+5,stroke:'#8da0b5'});chart.append(tick);const label=svg('text',{x:gx-4,y:height-bottom+18,transform:`rotate(-40 ${gx-4} ${height-bottom+18})`,'text-anchor':'end',fill:'#50647a','font-size':12,'font-weight':'normal'});label.textContent=gene;chart.append(label);});
  datasets.forEach((d,di)=>{const mode=d.result_only&&state.modes[di]!=='hidden'?'mean':state.modes[di];if(mode==='hidden')return;const summariesForDataset=summaries[di],c=color(di);if(['mean','both'].includes(mode)){let segment=[];const flush=()=>{if(segment.length>1)chart.append(svg('polyline',{points:segment.map(point=>point.join(',')).join(' '),fill:'none',stroke:c,'stroke-width':3.3,opacity:.92}));segment=[];};geneIndices.forEach((gi,position)=>{const s=summariesForDataset[gi];if(!s){flush();return;}segment.push([x(position),y(s.mean)]);});flush();geneIndices.forEach((gi,position)=>{const s=summariesForDataset[gi];if(!s)return;const p=svg('circle',{cx:x(position),cy:y(s.mean),r:6.8,fill:c,stroke:'#fff','stroke-width':1.5});p.style.cursor='default';const emphasize=()=>{if(chart.lastElementChild!==p)chart.append(p);p.setAttribute('r','9');p.setAttribute('stroke',highlightPalette[di%highlightPalette.length]);p.setAttribute('stroke-width','3');};p.onmouseenter=e=>{emphasize();showMeanTip(e,di,gi,s);};p.onmousemove=e=>{emphasize();showMeanTip(e,di,gi,s);};p.onmouseleave=()=>{p.setAttribute('r','6.8');p.setAttribute('stroke','#fff');p.setAttribute('stroke-width','1.5');hideTip();};trendDots.push(p);chart.append(p);addSignificanceMarker(chart,d,di,gi,x(position));});}if(['points','both'].includes(mode)){geneIndices.forEach((gi,position)=>{const s=summariesForDataset[gi];if(!s)return;if(mode==='points')addSignificanceMarker(chart,d,di,gi,x(position));s.members.forEach((m,si)=>{const contribution=m.log-s.ma,offset=((si%7)-3)*3.2,p=svg('circle',{cx:x(position)+offset,cy:y(contribution),r:3.8,fill:m.group==='Group A'?'#fff':c,stroke:c,'stroke-width':1.5,opacity:.94});p.style.cursor='pointer';p.onmouseenter=e=>showDotSample(e,di,m,gi,s);p.onmousemove=e=>showTip(e,di,m,gi,s);p.onmouseleave=clearDotSample;chart.append(p);});});}});
  trendDots.forEach(dot=>chart.append(dot));
  const sampleOverlay=svg('g',{'pointer-events':'none'});chart.append(sampleOverlay);
  updateSampleOverlay=target=>{sampleOverlay.replaceChildren();if(!target||state.modes[target.di]==='hidden')return;const di=target.di,si=target.si,c=color(di),points=[];geneIndices.forEach((gi,position)=>{const s=summaries[di][gi];if(!s){points.push(null);return;}const memberIndex=s.members.findIndex(item=>item.si===si);if(memberIndex<0){points.push(null);return;}const member=s.members[memberIndex],offset=((memberIndex%7)-3)*3.2;points.push([x(position)+offset,y(member.log-s.ma)]);});const drawSegments=(stroke,widthValue,opacity)=>{let segment=[];const flush=()=>{if(segment.length>1)sampleOverlay.append(svg('polyline',{points:segment.map(point=>point.join(',')).join(' '),fill:'none',stroke,'stroke-width':widthValue,opacity,'stroke-linecap':'round','stroke-linejoin':'round'}));segment=[];};points.forEach(point=>{if(!point){flush();return;}segment.push(point);});flush();};drawSegments('#fff',5.5,.9);drawSegments(c,1.8,1);points.forEach(point=>{if(!point)return;sampleOverlay.append(svg('circle',{cx:point[0],cy:point[1],r:6.8,fill:c,stroke:'#fff','stroke-width':2}));});};
  updateSampleOverlay(state.hoverSample);
  yAxisLayer.replaceChildren();const fixedAxis=svg('svg',{width:76,height,viewBox:`0 0 76 ${height}`});for(let k=0;k<=5;k++){const value=min+(max-min)*k/5,cy=y(value),tick=svg('text',{x:65,y:cy+4,'text-anchor':'end',fill:'#63758b','font-size':11});tick.textContent=value.toFixed(2);fixedAxis.append(tick);}fixedAxis.append(svg('line',{x1:72,y1:top,x2:72,y2:height-bottom,stroke:'#8da0b5','stroke-width':1}));const axis=svg('text',{x:14,y:height/2,transform:`rotate(-90 14 ${height/2})`,'text-anchor':'middle',fill:'#41546a','font-size':13});axis.textContent=state.showType==='mean'?'Log2 fold change (B vs A)':'Log2 expression relative to Group A mean';fixedAxis.append(axis);yAxisLayer.append(fixedAxis);
  const shade=svg('g',{'pointer-events':'none'});chart.append(shade);
  updateGeneHighlight=gi=>{shade.replaceChildren();if(gi===null)return;const position=geneIndices.indexOf(gi);if(position<0)return;geneIndices.forEach((_,index)=>{if(index===position)return;shade.append(svg('rect',{x:left+index*slot,y:top,width:slot,height:height-top-25,fill:'#203247',opacity:.13}));});};
  updateGeneHighlight(state.hoverGene);
  chart.addEventListener('mousemove',event=>{const rect=chart.getBoundingClientRect(),px=(event.clientX-rect.left)*width/rect.width;if(px<left||px>width-right||!shownCount){if(state.hoverGene!==null){state.hoverGene=null;applyGenePanelHighlight();updateGeneHighlight(null);}return;}setGeneHover(geneIndices[Math.max(0,Math.min(shownCount-1,Math.floor((px-left)/slot)))]);});
  chart.addEventListener('mouseleave',()=>{if(state.hoverGene!==null){state.hoverGene=null;applyGenePanelHighlight();updateGeneHighlight(null);}});graph.append(chart);document.getElementById('nz-tip')?.remove();document.body.append(el('div','nz-tooltip'));
  const empty=!shownCount||datasets.every((d,di)=>state.modes[di]==='hidden'||geneIndices.every(gi=>!summaries[di][gi]));if(empty){const note=el('div','nz-warning','No comparison is drawable with the current settings.');note.style.padding='10px 75px';graph.append(note);}updateFooter();
}
async function recalculateStatistics(){if(state.statsRunning)return;try{await saveView();for(let di=0;di<datasets.length;di++){if(state.graphType!=='trend'?di!==state.maDatasetIndex:state.modes[di]==='hidden')continue;const d=datasets[di];if(d.no_contrast)throw new Error('Set a Group A/B comparison with your AI first.');const response=await api('start_analysis',{comparison_id:d.dataset_id,kind:'differential',base_revision:localRevision,request_id:crypto.randomUUID()});localRevision=response.revision;}state.statsRunning=true;updateStatisticsBadge();showToast('Analysis started. The design and original counts are retained.');parent.postMessage({type:'workspace-saved'},location.origin);}catch(e){showToast(e.message);}}
function renderActiveGraph(){if(state.graphType==='pca')drawPCA();else if(state.graphType==='ma')drawMA();else if(state.graphType==='heatmap')drawHeatmap();else renderChart();}
function renderAll(){renderSide();renderGenePanel();renderActiveGraph();}
document.getElementById('nz-hide-nonsig').onchange=event=>{state.hideNonsig=event.target.checked;renderActiveGraph();};
function updateSignificanceControls(){state.cutoff=cutoffValues[state.cutoffIndex];const label=metricLabel();significanceToggle.textContent=label;significanceToggle.title='Click to switch significance metric';document.getElementById('nz-cutoff').value=String(state.cutoffIndex);document.getElementById('nz-cutoff-value').value=state.cutoff.toFixed(2);document.getElementById('nz-hide-label').textContent='Hide genes with '+label+' above cutoff';renderActiveGraph();}
significanceToggle.onclick=()=>{state.significanceMetric=state.significanceMetric==='adj_p'?'p_value':'adj_p';updateSignificanceControls();};
document.getElementById('nz-cutoff').oninput=event=>{state.cutoffIndex=Number(event.target.value);updateSignificanceControls();};
document.getElementById('nz-cutoff-minus').onclick=()=>{state.cutoffIndex=Math.max(0,state.cutoffIndex-1);updateSignificanceControls();};
document.getElementById('nz-cutoff-plus').onclick=()=>{state.cutoffIndex=Math.min(cutoffValues.length-1,state.cutoffIndex+1);updateSignificanceControls();};
recalculateButton.onclick=recalculateStatistics;
scroll.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<Math.abs(event.deltaX))return;scroll.scrollLeft+=event.deltaY;event.preventDefault();},{passive:false});
let trendPan=null;
scroll.addEventListener('pointerdown',event=>{if(state.graphType!=='trend'||event.button!==1)return;event.preventDefault();trendPan={pointerId:event.pointerId,startX:event.clientX,startLeft:scroll.scrollLeft};scroll.setPointerCapture(event.pointerId);hideTip();});
scroll.addEventListener('pointermove',event=>{if(!trendPan||event.pointerId!==trendPan.pointerId)return;event.preventDefault();scroll.scrollLeft=trendPan.startLeft+trendPan.startX-event.clientX;});
function stopTrendPan(event){if(!trendPan||event.pointerId!==trendPan.pointerId)return;trendPan=null;if(scroll.hasPointerCapture(event.pointerId))scroll.releasePointerCapture(event.pointerId);}
scroll.addEventListener('pointerup',stopTrendPan);scroll.addEventListener('pointercancel',stopTrendPan);
scroll.addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});
scroll.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
const showTypeSelector=document.getElementById('nz-show-type-select'),maView=document.getElementById('nz-ma-view'),maCanvas=document.getElementById('nz-ma-canvas'),maContext=maCanvas.getContext('2d'),maNote=document.getElementById('nz-ma-status'),maTip=document.getElementById('nz-ma-tip');
const heatmapView=document.getElementById('nz-heatmap-view'),unsupportedDatasets=data.unsupported_datasets||[];
const heatmapTip=el('div','nz-ma-tip');document.body.append(heatmapTip);
let heatmapPan=null,heatmapNeedsCenter=true;
function applyHeatmapScale(nextScale,anchorEvent=null){
  const plot=heatmapView.querySelector('svg[data-base-width]');if(!plot)return;
  const oldRect=plot.getBoundingClientRect(),anchorX=anchorEvent?Math.max(0,Math.min(1,(anchorEvent.clientX-oldRect.left)/Math.max(1,oldRect.width))):.5,anchorY=anchorEvent?Math.max(0,Math.min(1,(anchorEvent.clientY-oldRect.top)/Math.max(1,oldRect.height))):.5;
  state.heatmapScale=Math.max(.6,Math.min(8,nextScale));
  plot.setAttribute('width',String(Number(plot.dataset.baseWidth)*state.heatmapScale));plot.setAttribute('height',String(Number(plot.dataset.baseHeight)*state.heatmapScale));
  if(anchorEvent){const newRect=plot.getBoundingClientRect();heatmapView.scrollLeft+=newRect.left+anchorX*newRect.width-anchorEvent.clientX;heatmapView.scrollTop+=newRect.top+anchorY*newRect.height-anchorEvent.clientY;}
}
heatmapView.addEventListener('wheel',event=>{if(state.graphType!=='heatmap')return;event.preventDefault();applyHeatmapScale(state.heatmapScale*Math.exp(-event.deltaY*.0015),event);},{passive:false});
heatmapView.addEventListener('pointerdown',event=>{if(state.graphType!=='heatmap'||event.button!==1)return;event.preventDefault();heatmapPan={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startLeft:heatmapView.scrollLeft,startTop:heatmapView.scrollTop};heatmapView.setPointerCapture(event.pointerId);});
heatmapView.addEventListener('pointermove',event=>{if(!heatmapPan||event.pointerId!==heatmapPan.pointerId)return;event.preventDefault();heatmapView.scrollLeft=heatmapPan.startLeft+heatmapPan.startX-event.clientX;heatmapView.scrollTop=heatmapPan.startTop+heatmapPan.startY-event.clientY;});
function stopHeatmapPan(event){if(!heatmapPan||event.pointerId!==heatmapPan.pointerId)return;heatmapPan=null;if(heatmapView.hasPointerCapture(event.pointerId))heatmapView.releasePointerCapture(event.pointerId);}
heatmapView.addEventListener('pointerup',stopHeatmapPan);heatmapView.addEventListener('pointercancel',stopHeatmapPan);
heatmapView.addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});heatmapView.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
if(unsupportedDatasets.length)document.getElementById('nz-ma-unsupported').textContent='MA plot unavailable: '+unsupportedDatasets.map(d=>d.label+' ('+d.input_data+')').join(', ');
let maBuckets=new Map(),maDrawing=0,maDragging=false,maLast=null,maPanPointerId=null,maLeftDown=null,maFrame=0,maHoverGene=null,maHoverPointName=null;
const geneIndexByName=new Map(genes.map((gene,gi)=>[gene.toLowerCase(),gi]));
function rebuildGeneIndex(){geneIndexByName.clear();genes.forEach((gene,gi)=>geneIndexByName.set(gene.toLowerCase(),gi));}
const maDomainCache=new WeakMap();
function scheduleMADraw(){if(maFrame)return;maFrame=requestAnimationFrame(()=>{maFrame=0;drawMA();});}
function limitMAPan(v,plotWidth,verticalRange){const horizontal=Math.max(0,((v.baseWidth||plotWidth)*v.scale*1.5-plotWidth)/2);v.panX=Math.max(-horizontal,Math.min(horizontal,v.panX));if(verticalRange)v.panY=Math.max(verticalRange.min,Math.min(verticalRange.max,v.panY));}
async function unpackGzip(encoded){const binary=Uint8Array.from(atob(encoded),character=>character.charCodeAt(0)),stream=new Blob([binary]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text());}
async function loadMA(d){if(!d.ma_load_promise)d.ma_load_promise=Promise.all([unpackGzip(d.ma_points_gzip),unpackGzip(d.ma_matrix_gzip)]).then(([points,matrix])=>{d.ma_points=points;d.ma_matrix=matrix;d.ma_index=new Map();points.forEach((point,i)=>{const key=point[0].toLowerCase();if(!d.ma_index.has(key))d.ma_index.set(key,i);});});await d.ma_load_promise;}
function currentMAPoints(d,di){
  const selected=state.checked[di],key=selected.map(Number).join('');
  if(!state.statsDirty[di]&&d.statistics_current)return {points:d.ma_points,outdated:false};
  if(state.recalculated[di]&&selectionMatches(di,state.recalcSelection[di])&&d.ma_recalculated_points)return {points:d.ma_recalculated_points,outdated:false};
  if(d.ma_dynamic_cache?.key===key)return {points:d.ma_dynamic_cache.points,outdated:true};
  const a=[],b=[];d.samples.forEach((sample,si)=>{if(!selected[si])return;(sample.group==='Group A'?a:b).push(si);});
  if(!a.length||!b.length)return {points:[],outdated:true};
  const points=[];
  d.ma_points.forEach((old,i)=>{const row=d.ma_matrix[i],read=si=>{const raw=row[si];return finite(raw)?(d.prelogged?raw:(raw>=0?Math.log2(raw+data.log_offset):NaN)):NaN;},av=a.map(read).filter(finite),bv=b.map(read).filter(finite);if(av.length!==a.length||bv.length!==b.length)return;if(!d.prelogged&&[...a,...b].filter(si=>finite(row[si])&&row[si]>0).length<2)return;const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length,ma=mean(av),mb=mean(bv);points.push([old[0],mean([...av,...bv]),mb-ma,null,null]);});
  d.ma_dynamic_cache={key,points};return {points,outdated:true};
}
function getMADomain(points){let domain=maDomainCache.get(points);if(domain)return domain;let xMin=Infinity,xMax=-Infinity,fullMinY=Infinity,fullMaxY=-Infinity;const absY=[];for(const p of points){xMin=Math.min(xMin,p[1]);xMax=Math.max(xMax,p[1]);fullMinY=Math.min(fullMinY,p[2]);fullMaxY=Math.max(fullMaxY,p[2]);absY.push(Math.abs(p[2]));}absY.sort((a,b)=>a-b);const xSpan=Math.max(1,xMax-xMin);domain={min:xMin-xSpan*.04,max:xMax+xSpan*.04,yLimit:Math.max(.25,absY[Math.min(absY.length-1,Math.floor(absY.length*.995))]),fullMinY,fullMaxY};maDomainCache.set(points,domain);return domain;}
async function drawMA(){
  if(state.graphType!=='ma')return;
  const token=++maDrawing,di=state.maDatasetIndex,d=datasets[di],ctx=maContext;
  if(!d){maNote.textContent='Select a supported GSE.';return;}
  if(!d.ma_points){maNote.textContent='Loading MA plot data…';try{await loadMA(d);}catch(error){maNote.textContent='MA data could not be opened: '+(error.message||error);return;}}
  if(token!==maDrawing||state.graphType!=='ma'||di!==state.maDatasetIndex)return;
  const rect=maCanvas.getBoundingClientRect(),ratio=Math.min(2,window.devicePixelRatio||1),w=Math.max(1,Math.round(rect.width*ratio)),h=Math.max(1,Math.round(rect.height*ratio));if(maCanvas.width!==w||maCanvas.height!==h){maCanvas.width=w;maCanvas.height=h;}
  const left=85*ratio,right=25*ratio,top=25*ratio,bottom=68*ratio,plotW=w-left-right,plotH=h-top-bottom,cx=left+plotW/2,cy=top+plotH/2,v=state.maViewport;v.baseWidth=plotH*1.3/ratio;const xScale=v.scale*1.5,yScale=v.scale*1,xWidth=v.baseWidth*ratio;if(v.initialRight){v.panX=0;v.panY=0;delete v.initialRight;}limitMAPan(v,plotW/ratio);
  const {points,outdated}=currentMAPoints(d,di);
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);maBuckets=new Map();
  if(!points.length){maNote.textContent='No genes have expression in both selected groups.';return;}
  const {min,max,yLimit,fullMinY,fullMaxY}=getMADomain(points);
  const yWithoutPan=value=>cy+((top+(yLimit-value)*plotH/(2*yLimit))-cy)*yScale;
  const edgePadding=20*ratio;limitMAPan(v,plotW/ratio,{min:Math.min(0,(h-bottom-edgePadding-yWithoutPan(fullMinY))/ratio),max:Math.max(0,(top+edgePadding-yWithoutPan(fullMaxY))/ratio)});
  const x=value=>cx+(value-(min+max)/2)*xWidth/(max-min)*xScale+v.panX*ratio;
  const y=value=>cy+((top+(yLimit-value)*plotH/(2*yLimit))-cy)*yScale+v.panY*ratio;
  const invX=px=>(min+max)/2+(px-cx-v.panX*ratio)*(max-min)/(xWidth*xScale);
  const invY=py=>yLimit-(((py-cy-v.panY*ratio)/yScale+cy)-top)*2*yLimit/plotH;
  ctx.font=(11*ratio)+'px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
  for(let i=0;i<=5;i++){const py=top+i*plotH/5,value=invY(py);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.strokeStyle='#e6edf5';ctx.lineWidth=ratio;ctx.stroke();ctx.fillStyle='#52657e';ctx.fillText(value.toFixed(2),left-9*ratio,py);}
  const zeroY=y(0);if(zeroY>=top&&zeroY<=h-bottom){ctx.beginPath();ctx.moveTo(left,zeroY);ctx.lineTo(w-right,zeroY);ctx.strokeStyle='#526b83';ctx.lineWidth=1.6*ratio;ctx.stroke();}
  ctx.textAlign='center';ctx.textBaseline='top';for(let i=0;i<=5;i++){const px=left+i*plotW/5,value=invX(px);ctx.fillStyle='#52657e';ctx.fillText(value.toFixed(2),px,h-bottom+9*ratio);}
  ctx.fillStyle='#31465d';ctx.font=(13*ratio)+'px Arial';ctx.fillText('Average log2 expression (AveExpr)',cx,h-23*ratio);ctx.save();ctx.translate(20*ratio,cy);ctx.rotate(-Math.PI/2);ctx.fillText('Log2 fold change (B vs A)',0,0);ctx.restore();
  let significant=0;const drawn=[],edgeMarkers=[],selectedGenes=new Set(genes.filter((_,gi)=>!state.hiddenGenes.has(gi)).map(g=>g.toLowerCase())),hoverGene=state.hoverGene===null?null:genes[state.hoverGene]?.toLowerCase();ctx.save();ctx.beginPath();ctx.rect(left,top,plotW,plotH);ctx.clip();
  for(const p of points){const score=p[state.significanceMetric==='p_value'?3:4],pass=finite(score)&&score<=state.cutoff;if(pass)significant++;const px=x(p[1]),py=y(p[2]),offscreen=px<left||px>w-right||py<top||py>h-bottom;if(offscreen){if(selectedGenes.has(p[0].toLowerCase())){const mx=Math.max(left+9*ratio,Math.min(w-right-9*ratio,px)),my=Math.max(top+9*ratio,Math.min(h-bottom-9*ratio,py)),direction=px<left?'left':px>w-right?'right':py<top?'up':'down';edgeMarkers.push({point:p,x:mx,y:my,direction});}continue;}ctx.beginPath();ctx.arc(px,py,(pass?2.35:1.7)*ratio,0,Math.PI*2);ctx.fillStyle=pass?color(di):'#9ba3ad';ctx.globalAlpha=pass?.85:.48;ctx.fill();const key=Math.floor(px/(14*ratio))+','+Math.floor(py/(14*ratio));if(!maBuckets.has(key))maBuckets.set(key,[]);maBuckets.get(key).push({point:p,x:px,y:py});drawn.push({point:p,x:px,y:py});}
  ctx.globalAlpha=1;
  for(const item of drawn){const name=item.point[0].toLowerCase(),panelHover=name===hoverGene,cursored=name===maHoverPointName,searched=name===state.maSearchName,listed=selectedGenes.has(name);let tier=listed?1:0;if(searched)tier=2;if(panelHover||cursored)tier=Math.max(tier,listed||panelHover?2:1);if(searched&&(panelHover||cursored))tier=3;if(!tier)continue;const ringColor=highlightColor(di);if(tier===3){ctx.beginPath();ctx.arc(item.x,item.y,17*ratio,0,Math.PI*2);ctx.fillStyle=ringColor;ctx.globalAlpha=.2;ctx.fill();ctx.globalAlpha=1;}ctx.beginPath();ctx.arc(item.x,item.y,(tier===3?12:tier===2?9:6)*ratio,0,Math.PI*2);ctx.strokeStyle=ringColor;ctx.lineWidth=(tier===3?4.5:tier===2?3.5:2)*ratio;ctx.stroke();}
  for(const item of edgeMarkers){const name=item.point[0].toLowerCase(),second=name===hoverGene||name===maHoverPointName,size=(second?10:7)*ratio,mx=item.x,my=item.y;ctx.beginPath();if(item.direction==='up'){ctx.moveTo(mx,my-size);ctx.lineTo(mx-size*.8,my+size*.65);ctx.lineTo(mx+size*.8,my+size*.65);}else if(item.direction==='down'){ctx.moveTo(mx,my+size);ctx.lineTo(mx-size*.8,my-size*.65);ctx.lineTo(mx+size*.8,my-size*.65);}else if(item.direction==='left'){ctx.moveTo(mx-size,my);ctx.lineTo(mx+size*.65,my-size*.8);ctx.lineTo(mx+size*.65,my+size*.8);}else{ctx.moveTo(mx+size,my);ctx.lineTo(mx-size*.65,my-size*.8);ctx.lineTo(mx-size*.65,my+size*.8);}ctx.closePath();ctx.fillStyle=highlightColor(di);ctx.strokeStyle='#fff';ctx.lineWidth=1.5*ratio;ctx.fill();ctx.stroke();const key=Math.floor(mx/(14*ratio))+','+Math.floor(my/(14*ratio));if(!maBuckets.has(key))maBuckets.set(key,[]);maBuckets.get(key).push({point:item.point,x:mx,y:my});}
  ctx.restore();maNote.textContent=points.length.toLocaleString()+' genes · '+significant.toLocaleString()+' pass cutoff'+(outdated?' · Significance update pending':'');
}
function setMACanvasHover(pointName,gi){
  let changed=maHoverPointName!==pointName;
  maHoverPointName=pointName;
  if(maHoverGene!==gi){if(maHoverGene!==null&&state.hoverGene===maHoverGene)state.hoverGene=null;maHoverGene=gi;if(gi!==null)state.hoverGene=gi;applyGenePanelHighlight();changed=true;}
  if(changed)scheduleMADraw();
}
function nearestMAPoint(event){const rect=maCanvas.getBoundingClientRect(),px=(event.clientX-rect.left)*maCanvas.width/rect.width,py=(event.clientY-rect.top)*maCanvas.height/rect.height,ratio=maCanvas.width/rect.width,cx=Math.floor(px/(14*ratio)),cy=Math.floor(py/(14*ratio));let nearest=null,distance=(9*ratio)**2;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const item of maBuckets.get((cx+dx)+','+(cy+dy))||[]){const delta=(item.x-px)**2+(item.y-py)**2;if(delta<distance){distance=delta;nearest=item;}}return nearest;}
maCanvas.addEventListener('mousemove',event=>{if(maDragging)return;const nearest=nearestMAPoint(event);if(!nearest){maTip.style.display='none';setMACanvasHover(null,null);return;}const p=nearest.point,d=datasets[state.maDatasetIndex],gi=geneIndexByName.get(p[0].toLowerCase()),rect=maCanvas.getBoundingClientRect();setMACanvasHover(p[0].toLowerCase(),gi===undefined?null:gi);fillPointTip(maTip,d.label,p[0],p[2],p[1],p[3],p[4],{ma:true,outdated:state.statsDirty[state.maDatasetIndex]});positionPlotTip(maTip,event);});
maCanvas.addEventListener('mouseleave',()=>{maTip.style.display='none';setMACanvasHover(null,null);});
function minimumMAScale(rect){const d=datasets[state.maDatasetIndex];if(!d?.ma_points)return 1;const {points}=currentMAPoints(d,state.maDatasetIndex);if(!points.length)return 1;const domain=getMADomain(points),plotH=Math.max(1,rect.height-93),plotW=Math.max(1,rect.width-110),fitX=plotW/(plotH*1.3*1.5),fitY=2*domain.yLimit/Math.max(.5,domain.fullMaxY-domain.fullMinY);return Math.max(.05,Math.min(1,Math.max(fitX,fitY)));}
maCanvas.addEventListener('wheel',event=>{event.preventDefault();const rect=maCanvas.getBoundingClientRect(),v=state.maViewport,cx=rect.width/2,cy=rect.height/2,ax=event.clientX-rect.left,ay=event.clientY-rect.top,old=v.scale,next=Math.max(minimumMAScale(rect),Math.min(12,old*Math.exp(-event.deltaY*.0015)));v.panX=ax-cx-(ax-cx-v.panX)*next/old;v.panY=ay-cy-(ay-cy-v.panY)*next/old;v.scale=next;limitMAPan(v,(maCanvas.width-110*(maCanvas.width/rect.width))/(maCanvas.width/rect.width));scheduleMADraw();},{passive:false});
maCanvas.addEventListener('pointerdown',event=>{if(event.button===0){maLeftDown={pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};return;}if(event.button!==1)return;event.preventDefault();maDragging=true;maPanPointerId=event.pointerId;maLast={x:event.clientX,y:event.clientY};maCanvas.classList.add('dragging');maCanvas.setPointerCapture(event.pointerId);maTip.style.display='none';});
maCanvas.addEventListener('pointermove',event=>{if(maLeftDown&&event.pointerId===maLeftDown.pointerId&&Math.hypot(event.clientX-maLeftDown.x,event.clientY-maLeftDown.y)>5)maLeftDown.moved=true;if(!maDragging||event.pointerId!==maPanPointerId)return;event.preventDefault();state.maViewport.panX+=event.clientX-maLast.x;state.maViewport.panY+=event.clientY-maLast.y;const rect=maCanvas.getBoundingClientRect(),ratio=maCanvas.width/rect.width;limitMAPan(state.maViewport,(maCanvas.width-110*ratio)/ratio);maLast={x:event.clientX,y:event.clientY};scheduleMADraw();});
function stopMADrag(event){if(!maDragging||event.pointerId!==maPanPointerId)return;maDragging=false;maLast=null;maPanPointerId=null;maCanvas.classList.remove('dragging');if(maCanvas.hasPointerCapture(event.pointerId))maCanvas.releasePointerCapture(event.pointerId);}
maCanvas.addEventListener('pointerup',stopMADrag);maCanvas.addEventListener('pointercancel',event=>{if(maLeftDown?.pointerId===event.pointerId)maLeftDown=null;stopMADrag(event);});
maCanvas.addEventListener('click',event=>{if(event.button!==0)return;const moved=maLeftDown?.moved;maLeftDown=null;if(moved)return;const nearest=nearestMAPoint(event);if(nearest)addGene(nearest.point[0]);});
maCanvas.addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});
maCanvas.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
async function findMAGene(){
  const input=document.getElementById('nz-ma-gene-query'),query=input.value.trim().toLowerCase();
  if(!query){state.maSearchName=null;drawMA();return;}
  const di=state.maDatasetIndex,d=datasets[di];if(!d)return;
  try{await loadMA(d);}catch(error){showToast('MA data could not be opened.');return;}
  if(state.graphType!=='ma'||di!==state.maDatasetIndex)return;
  const {points}=currentMAPoints(d,di),point=points.find(item=>item[0].toLowerCase()===query);
  if(!point){state.maSearchName=null;drawMA();showToast('No exact gene name found in this GSE.');return;}
  state.maSearchName=point[0].toLowerCase();
  const rect=maCanvas.getBoundingClientRect(),ratio=maCanvas.width/rect.width,w=maCanvas.width,h=maCanvas.height,left=85*ratio,right=25*ratio,top=25*ratio,bottom=68*ratio,plotW=w-left-right,plotH=h-top-bottom,cx=left+plotW/2,cy=top+plotH/2,domain=getMADomain(points),v=state.maViewport;
  v.scale=Math.max(v.scale,4);
  const baseX=cx+(point[1]-(domain.min+domain.max)/2)*plotH*1.3/(domain.max-domain.min),baseY=top+(domain.yLimit-point[2])*plotH/(2*domain.yLimit);
  v.panX=-(baseX-cx)*v.scale*1.5/ratio;v.panY=-(baseY-cy)*v.scale*1/ratio;
  drawMA();
}
const maGeneQuery=document.getElementById('nz-ma-gene-query');
maGeneQuery.oninput=()=>{if(!maGeneQuery.value.trim()){state.maSearchName=null;drawMA();}};
maGeneQuery.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();findMAGene();}};
document.getElementById('nz-ma-gene-find').onclick=findMAGene;
function clusterHeatmap(vectors){
  const count=vectors.length,leaves=Array.from({length:count},(_,i)=>({members:[i],height:0,index:i}));
  if(count<2)return {order:leaves.map(node=>node.index),root:leaves[0]||null};
  const distances=Array.from({length:count},()=>Array(count).fill(0));
  for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
    let sum=0,common=0;
    vectors[i].forEach((value,k)=>{const other=vectors[j][k];if(finite(value)&&finite(other)){sum+=(value-other)**2;common++;}});
    distances[i][j]=distances[j][i]=common?Math.sqrt(sum/common):10;
  }
  let active=leaves;
  while(active.length>1){
    let best=Infinity,first=0,second=1;
    for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
      let sum=0;for(const a of active[i].members)for(const b of active[j].members)sum+=distances[a][b];
      const average=sum/(active[i].members.length*active[j].members.length);
      if(average<best-1e-10){best=average;first=i;second=j;}
    }
    const left=active[first],right=active[second],merged={left,right,members:[...left.members,...right.members],height:Math.max(best,left.height,right.height)};
    active=active.filter((_,index)=>index!==first&&index!==second);active.push(merged);
  }
  const order=[],walk=node=>{if(node.index!==undefined)order.push(node.index);else{walk(node.left);walk(node.right);}};
  walk(active[0]);return {order,root:active[0]};
}
function heatmapColor(value){
  if(!finite(value))return '#e8edf2';
  const bounded=Math.max(-2.5,Math.min(2.5,value)),t=Math.abs(bounded)/2.5;
  const from=bounded<0?[249,249,220]:[249,249,220],to=bounded<0?[57,100,159]:[211,37,47];
  return '#'+from.map((channel,i)=>Math.round(channel+(to[i]-channel)*t).toString(16).padStart(2,'0')).join('');
}
function drawHeatmap(){
  if(state.graphType!=='heatmap')return;
  heatmapView.replaceChildren();
  const di=state.maDatasetIndex,d=datasets[di];
  if(!d){heatmapView.textContent='Select a supported GSE.';return;}
  const sampleIndices=d.samples.map((_,si)=>si).filter(si=>state.checked[di][si]);
  const selectedGeneIndices=visibleGeneIndices(),allGeneIndices=selectedGeneIndices.filter(gi=>sampleIndices.some(si=>finite(d.values[gi]?.[si]))),geneIndices=allGeneIndices.slice(0,150);
  if(!sampleIndices.length||!geneIndices.length){heatmapView.textContent='Select at least one GSM and one gene with expression values.';return;}
  const expression=geneIndices.map(gi=>sampleIndices.map(si=>{const raw=d.values[gi]?.[si];if(!finite(raw))return null;if(d.count_library_sizes){const total=d.count_library_sizes[si];return raw>=0&&total>0?Math.log2(raw*1e6/total+1):null;}return d.prelogged?raw:(raw>=0?Math.log2(raw+data.log_offset):null); }));
  const normalized=expression.map(row=>{const valid=row.filter(finite);if(!valid.length)return row.map(()=>null);const mean=valid.reduce((sum,value)=>sum+value,0)/valid.length,variance=valid.reduce((sum,value)=>sum+(value-mean)**2,0)/valid.length,sd=Math.sqrt(variance);return row.map(value=>finite(value)?(sd>0?(value-mean)/sd:0):null);});
  const rowTree=clusterHeatmap(normalized),columnTree=clusterHeatmap(sampleIndices.map((_,column)=>normalized.map(row=>row[column])));
  const nRows=geneIndices.length,nCols=sampleIndices.length,cellW=Math.max(34,Math.min(67,620/nCols)),cellH=25,gridX=105,gridY=99,gridW=nCols*cellW,gridH=nRows*cellH,width=Math.max(allGeneIndices.length>150?850:710,gridX+gridW+175),height=gridY+gridH+112;
  const stage=el('div','nz-heatmap-stage');heatmapView.append(stage);
  const plot=svg('svg',{width,height,viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Clustered row z-score expression heatmap'});
  plot.dataset.baseWidth=String(width);plot.dataset.baseHeight=String(height);plot.style.fontFamily='Arial,sans-serif';stage.append(plot);applyHeatmapScale(state.heatmapScale);if(heatmapNeedsCenter){heatmapNeedsCenter=false;requestAnimationFrame(()=>{heatmapView.scrollLeft=Math.max(0,(heatmapView.scrollWidth-heatmapView.clientWidth)/2);heatmapView.scrollTop=Math.max(0,(heatmapView.scrollHeight-heatmapView.clientHeight)/2);});}
  const rowPositions=new Map(rowTree.order.map((index,position)=>[index,gridY+(position+.5)*cellH]));
  const columnPositions=new Map(columnTree.order.map((index,position)=>[index,gridX+(position+.5)*cellW]));
  const dendroColor='#526174',line=(x1,y1,x2,y2)=>plot.append(svg('line',{x1,y1,x2,y2,stroke:dendroColor,'stroke-width':1.35}));
  const topScale=columnTree.root?.height||1,leftScale=rowTree.root?.height||1;
  function drawColumnTree(node){if(node.index!==undefined)return {x:columnPositions.get(node.index),y:69};const a=drawColumnTree(node.left),b=drawColumnTree(node.right),y=69-58*node.height/topScale;line(a.x,a.y,a.x,y);line(b.x,b.y,b.x,y);line(a.x,y,b.x,y);return {x:(a.x+b.x)/2,y};}
  function drawRowTree(node){if(node.index!==undefined)return {x:97,y:rowPositions.get(node.index)};const a=drawRowTree(node.left),b=drawRowTree(node.right),x=97-87*node.height/leftScale;line(a.x,a.y,x,a.y);line(b.x,b.y,x,b.y);line(x,a.y,x,b.y);return {x,y:(a.y+b.y)/2};}
  if(columnTree.root)drawColumnTree(columnTree.root);if(rowTree.root)drawRowTree(rowTree.root);
  const groups=[['Group A','#20bdc4'],['Group B','#fa7f7b']];
  columnTree.order.forEach((column,displayColumn)=>{
    const si=sampleIndices[column],sample=d.samples[si],x=gridX+displayColumn*cellW,groupColor=groups.find(item=>item[0]===sample.group)?.[1]||'#9aa8b7';
    plot.append(svg('rect',{x,y:74,width:cellW,height:18,fill:groupColor,stroke:'#fff','stroke-width':1,'data-si':si}));
    const label=svg('text',{x:x+cellW/2,y:gridY+gridH+8,transform:`rotate(55 ${x+cellW/2} ${gridY+gridH+8})`,fill:'#30465e','font-size':11});label.textContent=sample.gsm||sample.name||sample.column;plot.append(label);
  });
  rowTree.order.forEach((row,displayRow)=>{
    const gi=geneIndices[row],y=gridY+displayRow*cellH,name=genes[gi],rowGroup=svg('g',{'data-gi':gi});
    columnTree.order.forEach((column,displayColumn)=>{
      const si=sampleIndices[column],value=normalized[row][column],raw=d.values[gi]?.[si],sample=d.samples[si],rect=svg('rect',{x:gridX+displayColumn*cellW,y,width:cellW,height:cellH,fill:heatmapColor(value),stroke:'#98a4ae','stroke-width':.7,'data-si':si,'data-heatmap-cell':'1'});
      const showCellTip=event=>{heatmapTip.replaceChildren();tipHeading(heatmapTip,name,sample.gsm||sample.name||sample.column);tipFields(heatmapTip,[['Log2 expression',fmt(expression[row][column])],['Row z-score',fmt(value)]]);positionPlotTip(heatmapTip,event);};
      rect.onmouseenter=event=>{setGeneHover(gi);state.hoverSample={di,si};applySideSampleHighlight();highlightHeatmapSample(si);showCellTip(event);};rect.onmousemove=showCellTip;
      rect.onmouseleave=()=>{heatmapTip.style.display='none';clearGeneHover(gi);state.hoverSample=null;applySideSampleHighlight();highlightHeatmapSample(null);};
      rowGroup.append(rect);
    });
    const label=svg('text',{x:gridX+gridW+8,y:y+cellH*.69,fill:'#213047','font-size':12});label.textContent=name;rowGroup.append(label);plot.append(rowGroup);
  });
  const legendY=height-29;
  const legendTitle=svg('text',{x:gridX,y:legendY-6,fill:'#42566d','font-size':11});legendTitle.textContent='Row z-score';plot.append(legendTitle);
  [-2,-1,0,1,2].forEach((value,index)=>{const boxX=gridX+75+index*33;plot.append(svg('rect',{x:boxX,y:legendY-16,width:33,height:14,fill:heatmapColor(value)}));const label=svg('text',{x:boxX+16,y:legendY+12,'text-anchor':'middle',fill:'#52657e','font-size':10});label.textContent=String(value);plot.append(label);});
  groups.forEach(([group,groupColor],index)=>{const x=gridX+285+index*95;plot.append(svg('rect',{x,y:legendY-15,width:12,height:12,fill:groupColor}));const label=svg('text',{x:x+17,y:legendY-4,fill:'#52657e','font-size':11});label.textContent=group;plot.append(label);});
  const dimensions=svg('text',{x:gridX+470,y:legendY-4,fill:'#52657e','font-size':11});dimensions.textContent=nRows+' genes × '+nCols+' GSMs'+(allGeneIndices.length>150?' (first 150)':'');plot.append(dimensions);
  highlightHeatmapGene=gi=>{plot.querySelectorAll('g[data-gi]').forEach(row=>{row.style.opacity=gi===null||Number(row.getAttribute('data-gi'))===gi?'1':'.3';});};
  highlightHeatmapSample=si=>{plot.querySelectorAll('rect[data-si]').forEach(rect=>{rect.style.opacity=si===null||Number(rect.getAttribute('data-si'))===si?'1':'.55';});};
  highlightHeatmapGene(state.hoverGene);highlightHeatmapSample(state.hoverSample?.di===di?state.hoverSample.si:null);
}

function switchGraph(type){state.graphType=type;document.getElementById('nz-ma-gene-query').placeholder=type==='pca'?'Exact sample name':'Exact gene name';document.getElementById('nz-ma-gene-query').setAttribute('aria-label',type==='pca'?'Find sample in PCA':'Find gene in MA plot');document.getElementById('nz-pca-view').style.display=type==='pca'?'block':'none';document.getElementById('nz-pca-settings').style.display=type==='pca'?'block':'none';recalculateButton.style.display='none';document.getElementById('nz-pca-run').disabled=false;for(const graphType of ['trend','ma','heatmap','pca']){const option=document.getElementById('nz-graph-'+graphType);option.classList.toggle('active',type===graphType);option.setAttribute('aria-pressed',String(type===graphType));}document.getElementById('nz-side-show').style.display=type==='trend'?'flex':'none';const unsupported=document.getElementById('nz-ma-unsupported');unsupported.style.display=type!=='trend'&&unsupportedDatasets.length?'block':'none';unsupported.textContent=(type==='heatmap'?'Heatmap':'MA plot')+' unavailable: '+unsupportedDatasets.map(d=>d.label+' ('+d.input_data+')').join(', ');document.getElementById('nz-ma-status').style.display=type==='ma'?'block':'none';document.getElementById('nz-ma-gene-search').style.display=['ma','pca'].includes(type)?'flex':'none';document.getElementById('nz-hide-filter').style.display='flex';document.getElementById('nz-hide-filter').style.visibility=type==='trend'?'visible':'hidden';document.querySelector('.nz-right-significance').classList.toggle('nz-ma-significance',type==='ma');document.querySelector('.nz-right-significance').style.display=['heatmap','pca'].includes(type)?'none':'flex';document.querySelector('.nz-stat-controls').style.display=type==='heatmap'?'none':'flex';scroll.style.display=type==='trend'?'block':'none';yAxisLayer.style.display=type==='trend'?'block':'none';maView.style.display=type==='ma'?'block':'none';heatmapView.style.display=type==='heatmap'?'block':'none';renderAll();}
document.getElementById('nz-graph-trend').onclick=()=>switchGraph('trend');document.getElementById('nz-graph-ma').onclick=()=>switchGraph('ma');document.getElementById('nz-graph-heatmap').onclick=()=>switchGraph('heatmap');
showTypeSelector.onchange=()=>{state.showType=showTypeSelector.value;state.modes=state.modes.map(mode=>mode==='hidden'?'hidden':state.showType);renderAll();};
window.addEventListener('resize',()=>{if(state.graphType==='ma')drawMA();else if(state.graphType==='pca')drawPCA();});
// Runs within the original Cell 5 closure. Hover stays transient; user choices persist.
let localRevision=data.revision,lastSaved='',saving=null,changeSince=0;
function restoreView(view){const v=view||{};for(const key of ['graphType','showType','cutoffIndex','significanceMetric','hideNonsig','maViewport','heatmapScale','maSearchName','lastSelectedDataset'])if(v[key]!==undefined)state[key]=v[key];state.maDatasetIndex=Math.max(0,datasets.findIndex(d=>d.dataset_id===v.maDatasetId));state.modes=datasets.map(d=>v.modes?.[d.dataset_id]||state.showType);if(state.modes.length&&state.modes.every(mode=>mode==="hidden"))state.modes[state.maDatasetIndex]=state.showType;state.collapsed=datasets.map(d=>v.collapsed?.[d.dataset_id]??true);state.hiddenGenes=new Set(genes.map((g,i)=>(v.hiddenGenes||[]).includes(g)?i:null).filter(i=>i!==null));document.getElementById('nz-show-type-select').value=state.showType;document.getElementById('nz-hide-nonsig').checked=state.hideNonsig;document.getElementById('nz-ma-gene-query').value=state.maSearchName||'';document.getElementById('nz-pca-top').value=String(v.pcaTop??500);}
function captureView(){const selected_samples={};datasets.forEach((d,di)=>{if(!d.no_contrast)selected_samples[d.dataset_id]=d.samples.filter((s,si)=>state.checked[di][si]).map(s=>s.id);});return {panel:[...genes],view:{graphType:state.graphType,showType:state.showType,lastSelectedDataset:state.lastSelectedDataset,cutoffIndex:state.cutoffIndex,significanceMetric:state.significanceMetric,hideNonsig:state.hideNonsig,hiddenGenes:[...state.hiddenGenes].map(i=>genes[i]),modes:Object.fromEntries(datasets.map((d,di)=>[d.dataset_id,state.modes[di]])),collapsed:Object.fromEntries(datasets.map((d,di)=>[d.dataset_id,state.collapsed[di]])),maDatasetId:datasets[state.maDatasetIndex]?.dataset_id,maViewport:{...state.maViewport},heatmapScale:state.heatmapScale,maSearchName:state.maSearchName,selected_samples,pcaTop:Number(document.getElementById('nz-pca-top').value),trendScroll:{x:scroll.scrollLeft,y:scroll.scrollTop}}};}
async function saveView(){
 if(saving)await saving;const current=captureView(),serial=JSON.stringify(current);if(serial===lastSaved)return;
 saving=(async()=>{try{
  let request={...current,project_id:data.project.id,base_revision:localRevision,request_id:crypto.randomUUID()},result;
  try{result=await api('update_view',request);}catch(e){
   if(e.code!=='revision_conflict')throw e;
   const fresh=await api('state',{},true);if(fresh.project?.id!==data.project.id){location.reload();return;}
   const baseline=JSON.parse(lastSaved),patch={},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),maps=new Set(['modes','collapsed','selected_samples','dataset_selected_samples']);
   for(const [key,value]of Object.entries(current.view))if(!same(value,baseline.view[key])){
    if(maps.has(key)){const merged={...(fresh.project.view[key]||{})};for(const [id,v]of Object.entries(value))if(!same(v,baseline.view[key]?.[id]))merged[id]=v;patch[key]=merged;}else patch[key]=value;
   }
   request={view:patch,project_id:data.project.id,base_revision:fresh.revision,request_id:crypto.randomUUID()};
   if(!same(current.panel,baseline.panel)){
    const removed=baseline.panel.filter(g=>!current.panel.includes(g)),remote=fresh.project.panel.filter(g=>!removed.includes(g));
    request.panel=[...current.panel.filter(g=>remote.includes(g)||!baseline.panel.includes(g)),...remote.filter(g=>!current.panel.includes(g))];
   }
   result=await api('update_view',request);
  }
  localRevision=result.revision;lastSaved=serial;parent.postMessage({type:'workspace-saved'},location.origin);
 }catch(e){showToast(e.message);if(e.code==='project_changed')location.reload();throw e;}finally{saving=null;}})();return saving;
}
function checkView(){const serial=JSON.stringify(captureView());if(serial===lastSaved){changeSince=0;return;}if(!changeSince){changeSince=Date.now();return;}if(Date.now()-changeSince>600&&!saving)saveView().catch(()=>{});}
window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='prepare-app-reload')return;try{await saveView();if(JSON.stringify(captureView())!==lastSaved)await saveView();parent.postMessage({type:'app-reload-ready',request:event.data.request},location.origin);}catch{parent.postMessage({type:'app-reload-failed',request:event.data.request},location.origin);}});
let refreshing=false;
window.addEventListener('message',async event=>{if(event.origin!==location.origin||event.data?.type!=='workspace-update'||!event.data.force||refreshing)return;refreshing=true;try{await saveView();if(JSON.stringify(captureView())!==lastSaved)await saveView();parent.postMessage({type:'viewer-loading'},location.origin);location.reload();}catch{}finally{refreshing=false;}});
const pcaCanvas=document.getElementById('nz-pca-canvas'),pcaContext=pcaCanvas.getContext('2d'),pcaTip=document.getElementById('nz-pca-tip');let pcaHover=null,pcaSelected=null,pcaGeometry=[],pcaViewport={scale:1,x:0,y:0,initial:true},pcaViewKey=null,pcaFeatureDataset=null,pcaPan=null;
const baseCaptureView=captureView;captureView=()=>{const value=baseCaptureView();value.view.dataset_selected_samples=Object.fromEntries(datasets.map((d,di)=>[d,di]).filter(([d])=>d.no_contrast).map(([d,di])=>[d.source_dataset_id,d.samples.filter((s,si)=>state.checked[di][si]).map(s=>s.id)]));return value;};
const pcaCache=new Map();
function pcaCacheKey(d,nTop,ids){return 'nozeomics-pca-v1:'+d.dataset_id+':'+nTop+':'+JSON.stringify([...ids].sort());}
function rememberPCA(d,p){if(!p?.sample_ids)return;const key=pcaCacheKey(d,p.n_top,p.sample_ids);pcaCache.set(key,p);try{localStorage.setItem(key,JSON.stringify(p));}catch{}}
function cachedPCA(d,nTop,ids){const key=pcaCacheKey(d,nTop,ids);if(pcaCache.has(key))return pcaCache.get(key);try{const p=JSON.parse(localStorage.getItem(key));if(p?.sample_ids&&p.n_top===nTop&&p.sample_ids.length===ids.length&&ids.every(id=>p.sample_ids.includes(id))){pcaCache.set(key,p);return p;}}catch{}return null;}
for(const d of datasets)rememberPCA(d,d.pca);
function syncPCAFeatures(d){if(pcaFeatureDataset!==d.dataset_id){document.getElementById('nz-pca-top').value='500';pcaViewport.initial=true;pcaFeatureDataset=d.dataset_id;}return Number(document.getElementById('nz-pca-top').value);}
function pcaData(){const d=datasets[state.maDatasetIndex];if(!d)return null;syncPCAFeatures(d);const ids=d.samples.filter((_,si)=>state.checked[state.maDatasetIndex][si]).map(s=>s.id);return cachedPCA(d,Number(document.getElementById('nz-pca-top').value),ids);}

function renderSamplePanel(){geneList.replaceChildren();const p=pcaData(),d=datasets[state.maDatasetIndex];geneTitle.textContent='Samples ('+(p?.points.length||0)+')';if(!p){geneList.append(el('p','nz-note','Calculate PCA to compare the selected samples.'));return;}for(const s of p.samples){const row=el('div','nz-gene-row',(s.gsm||s.id)+' · '+s.group);row.dataset.sample=s.id;row.classList.toggle('selected',s.id===pcaSelected||s.id===pcaHover);row.title=s.name||s.id;row.onmouseenter=()=>{pcaHover=s.id;drawPCA();};row.onmouseleave=()=>{pcaHover=null;drawPCA();};row.onclick=()=>{pcaSelected=pcaSelected===s.id?null:s.id;drawPCA();renderSamplePanel();};geneList.append(row);}const note=el('p','nz-note',p.n_features+' genes · '+p.samples.length+' samples\n'+p.rule);note.style.whiteSpace='pre-line';geneList.append(note);}
function drawPCA(){if(state.graphType!=='pca')return;const d=datasets[state.maDatasetIndex],p=pcaData(),rect=pcaCanvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2),w=Math.max(1,rect.width),h=Math.max(1,rect.height);pcaCanvas.width=w*ratio;pcaCanvas.height=h*ratio;const ctx=pcaContext;ctx.scale(ratio,ratio);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);pcaGeometry=[];if(!p){ctx.font='14px Arial';ctx.fillStyle='#68798d';ctx.fillText('Calculate PCA for the selected sample cohort.',65,70);return;}const left=70,right=70,top=65,bottom=65,pw=w-left-right,ph=h-top-bottom,xs=p.points.map(q=>q.x),ys=p.points.map(q=>q.y),cx=0,cy=0,spanX=Math.max(1,2*Math.max(...xs.map(Math.abs))),spanY=Math.max(1,2*Math.max(...ys.map(Math.abs))),unit=ph/Math.max(spanX,spanY)*.8*pcaViewport.scale,x=v=>left+pw/2+(v-cx)*unit+pcaViewport.x,y=v=>top+ph/2-(v-cy)*unit+pcaViewport.y,ix=px=>cx+(px-left-pw/2-pcaViewport.x)/unit,iy=py=>cy-(py-top-ph/2-pcaViewport.y)/unit;
 const viewKey=pcaCacheKey(d,p.n_top,p.sample_ids),minimum=minimumPCAScale(rect);if(pcaViewport.initial||pcaViewKey!==viewKey){pcaViewport.scale=Math.min(6,minimum*1.3);pcaViewport.x=0;pcaViewport.y=0;pcaViewport.initial=false;pcaViewKey=viewKey;return drawPCA();}if(pcaViewport.scale<minimum){pcaViewport.scale=minimum;return drawPCA();}const panLimit=pcaViewport.scale<=minimum+1e-6?0:Math.max(0,Math.max(spanX,spanY)*unit/2-Math.min(pw,ph)/2)+20;pcaViewport.x=Math.max(-panLimit,Math.min(panLimit,pcaViewport.x));pcaViewport.y=Math.max(-panLimit,Math.min(panLimit,pcaViewport.y));
 ctx.font='11px Arial';ctx.strokeStyle='#e3eaf2';ctx.lineWidth=1;for(let i=0;i<6;i++){const px=left+pw*i/5,py=top+ph*i/5;ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,h-bottom);ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.fillStyle='#65768b';ctx.textAlign='center';ctx.fillText(ix(px).toFixed(1),px,h-bottom+18);ctx.textAlign='right';ctx.fillText(iy(py).toFixed(1),left-8,py+4);}ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();ctx.strokeStyle='#526b83';ctx.lineWidth=1.6;const zeroX=x(0),zeroY=y(0);if(zeroX>=left&&zeroX<=w-right){ctx.beginPath();ctx.moveTo(zeroX,top);ctx.lineTo(zeroX,h-bottom);ctx.stroke();}if(zeroY>=top&&zeroY<=h-bottom){ctx.beginPath();ctx.moveTo(left,zeroY);ctx.lineTo(w-right,zeroY);ctx.stroke();}for(const point of p.points){const s=p.samples.find(s=>s.id===point.sample_id),px=x(point.x),py=y(point.y),active=[pcaHover,pcaSelected].includes(s.id);ctx.beginPath();ctx.arc(px,py,active?9:5.5,0,2*Math.PI);ctx.fillStyle=s.group==='Group A'?'#fff':color(state.maDatasetIndex);ctx.fill();ctx.strokeStyle=color(state.maDatasetIndex);ctx.lineWidth=1.8;ctx.stroke();if(active){ctx.beginPath();ctx.arc(px,py,13,0,2*Math.PI);ctx.strokeStyle='#a62553';ctx.lineWidth=2.5;ctx.stroke();}pcaGeometry.push({x:px,y:py,s,point});}if(document.getElementById('nz-pca-names').checked)drawPCANames(ctx,pcaGeometry,{left,top,right:w-right,bottom:h-bottom});ctx.restore();ctx.textAlign='center';ctx.fillStyle='#31465d';ctx.font='13px Arial';ctx.fillText('PC1 ('+(p.variance[0]*100).toFixed(1)+'%)',left+pw/2,h-17);ctx.save();ctx.translate(18,top+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText('PC2 ('+(p.variance[1]*100).toFixed(1)+'%)',0,0);ctx.restore();ctx.textAlign='left';ctx.font='12px Arial';const legend=document.getElementById('nz-pca-control-legend');legend.textContent='○ '+(d.a_label||'Control');legend.style.color=color(state.maDatasetIndex);const treatedLegend=document.getElementById('nz-pca-treated-legend');treatedLegend.textContent='● '+(d.b_label||'Treated');treatedLegend.style.color=color(state.maDatasetIndex);geneList.querySelectorAll('[data-sample]').forEach(row=>row.classList.toggle('selected',[pcaHover,pcaSelected].includes(row.dataset.sample)));}
document.getElementById('nz-graph-pca').onclick=()=>switchGraph('pca');
const pcaRequests=new Set();
async function ensurePCA(di=state.maDatasetIndex,nTop=500){const d=datasets[di];if(!d||!supportsPlot(d,'pca'))return;if(state.graphType==='pca'&&di===state.maDatasetIndex)nTop=syncPCAFeatures(d);const ids=d.samples.filter((_,si)=>state.checked[di][si]).map(s=>s.id),key=pcaCacheKey(d,nTop,ids),foreground=state.graphType==='pca'&&di===state.maDatasetIndex;
 if(cachedPCA(d,nTop,ids)){if(foreground){drawPCA();requestAnimationFrame(()=>parent.postMessage({type:'pca-ready',key},location.origin));}return;}
 if(foreground)parent.postMessage({type:'pca-loading',key},location.origin);
 if(pcaRequests.has(key))return;pcaRequests.add(key);try{await saveView();const fresh=await api('state',{},true);if(fresh.project?.id!==data.project.id){parent.postMessage({type:'pca-ready',key},location.origin);return;}if((fresh.jobs||[]).some(j=>j.project_id===data.project.id&&j.kind==='pca'&&['running','queued'].includes(j.status)&&(d.no_contrast?j.dataset_id===d.source_dataset_id:j.comparison_id===d.dataset_id)))return;const result=await api('start_analysis',{comparison_id:d.no_contrast?undefined:d.dataset_id,dataset_id:d.source_dataset_id,kind:'pca',n_top:nTop,base_revision:fresh.revision,request_id:crypto.randomUUID()});localRevision=result.revision;parent.postMessage({type:'workspace-saved'},location.origin);}catch(e){parent.postMessage({type:'pca-ready',key},location.origin);if(state.graphType==='pca')showToast(e.message);}finally{pcaRequests.delete(key);}}

document.getElementById('nz-pca-top').onchange=()=>{pcaFeatureDataset=datasets[state.maDatasetIndex].dataset_id;ensurePCA(state.maDatasetIndex,Number(document.getElementById('nz-pca-top').value));};
document.getElementById('nz-pca-names').onchange=()=>drawPCA();
document.getElementById('nz-pca-run').onclick=()=>ensurePCA(state.maDatasetIndex,Number(document.getElementById('nz-pca-top').value));

function drawPCANames(ctx,points,bounds){
 ctx.font='12px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
 const visible=points.filter(q=>q.x>=bounds.left&&q.x<=bounds.right&&q.y>=bounds.top&&q.y<=bounds.bottom),placed=[];
 const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 for(const q of visible){const text=q.s.gsm||q.s.id,width=ctx.measureText(text).width+6,height=18;let best=null;
  const consider=(cx,cy)=>{const left=Math.max(bounds.left+2,Math.min(bounds.right-width-2,cx-width/2)),top=Math.max(bounds.top+2,Math.min(bounds.bottom-height-2,cy-height/2)),box={left,top,right:left+width,bottom:top+height};let penalty=0;for(const label of placed)penalty+=overlap(box,{left:label.left-3,top:label.top-2,right:label.right+3,bottom:label.bottom+2});for(const dot of visible)penalty+=overlap(box,{left:dot.x-10,top:dot.y-10,right:dot.x+10,bottom:dot.y+10});const distance=Math.hypot(left+width/2-q.x,top+height/2-q.y),score=penalty*10000+distance;if(!best||score<best.score)best={...box,text,q,score,penalty};};
  for(let radius=0;radius<=180;radius+=18){for(const [dx,dy] of [[1,0],[-1,0],[0,-1],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]])consider(q.x+dx*(width/2+12+radius),q.y+dy*(height/2+12+radius));if(best.penalty===0)break;}
  if(best.penalty>0)for(let cy=bounds.top+height/2+2;cy<bounds.bottom-height/2;cy+=height+4)for(let cx=bounds.left+width/2+2;cx<bounds.right-width/2;cx+=Math.max(20,width/2))consider(cx,cy);
  placed.push(best);
 }
 for(const b of placed){const ex=Math.max(b.left,Math.min(b.right,b.q.x)),ey=Math.max(b.top,Math.min(b.bottom,b.q.y));if(Math.hypot(ex-b.q.x,ey-b.q.y)>14){ctx.beginPath();ctx.moveTo(b.q.x,b.q.y);ctx.lineTo(ex,ey);ctx.strokeStyle='#9aafc3';ctx.lineWidth=.8;ctx.stroke();}}
 for(const b of placed){ctx.fillStyle='#fffffff0';ctx.fillRect(b.left,b.top,b.right-b.left,b.bottom-b.top);ctx.fillStyle='#31465d';ctx.fillText(b.text,b.left+3,(b.top+b.bottom)/2);}
 ctx.textBaseline='alphabetic';
}
function nearestPCA(e){const r=pcaCanvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let found=null,best=160;for(const q of pcaGeometry){const distance=(q.x-x)**2+(q.y-y)**2;if(distance<best){best=distance;found=q;}}return found;}
pcaCanvas.onmousemove=e=>{if(pcaPan)return;const q=nearestPCA(e);pcaHover=q?.s.id||null;const sampleIndex=q?datasets[state.maDatasetIndex].samples.findIndex(s=>s.id===q.s.id):-1;state.hoverSample=sampleIndex>=0?{di:state.maDatasetIndex,si:sampleIndex}:null;applySideSampleHighlight();drawPCA();if(!q){pcaTip.style.display='none';return;}pcaTip.replaceChildren();const sample=sampleMetadata.get(q.s.gsm||q.s.id)||q.s;pcaTip.append(el('div','nz-sample-tip-gsm',q.s.gsm||sample.gsm||q.s.id),el('div','nz-sample-tip-name',sample.name||q.s.name||q.s.id));tipFields(pcaTip,[['PC1',fmt(q.point.x)],['PC2',fmt(q.point.y)]]);positionPlotTip(pcaTip,e);} ;pcaCanvas.onmouseleave=()=>{pcaHover=null;state.hoverSample=null;applySideSampleHighlight();pcaTip.style.display='none';drawPCA();};
function minimumPCAScale(rect){const p=pcaData();if(!p?.points.length)return 1;const xs=p.points.map(q=>q.x),ys=p.points.map(q=>q.y),sx=Math.max(1,2*Math.max(...xs.map(Math.abs))),sy=Math.max(1,2*Math.max(...ys.map(Math.abs))),pw=Math.max(1,rect.width-140),ph=Math.max(1,rect.height-130),base=ph/Math.max(sx,sy)*.8;return Math.max(.05,Math.min(1,Math.min(pw/sx,ph/sy)/base)*.65);}
pcaCanvas.addEventListener('wheel',e=>{e.preventDefault();const r=pcaCanvas.getBoundingClientRect(),next=Math.max(minimumPCAScale(r),Math.min(6,pcaViewport.scale*Math.exp(-e.deltaY*.0015))),factor=next/pcaViewport.scale,ax=e.clientX-r.left-r.width/2,ay=e.clientY-r.top-r.height/2;pcaViewport.x=ax-(ax-pcaViewport.x)*factor;pcaViewport.y=ay-(ay-pcaViewport.y)*factor;pcaViewport.scale=next;drawPCA();},{passive:false});pcaCanvas.onpointerdown=e=>{if(e.button!==1)return;e.preventDefault();pcaPan={id:e.pointerId,x:e.clientX,y:e.clientY};pcaCanvas.setPointerCapture(e.pointerId);};pcaCanvas.onpointermove=e=>{if(!pcaPan||pcaPan.id!==e.pointerId)return;pcaViewport.x+=e.clientX-pcaPan.x;pcaViewport.y+=e.clientY-pcaPan.y;pcaPan.x=e.clientX;pcaPan.y=e.clientY;drawPCA();};pcaCanvas.onpointerup=e=>{if(pcaPan){pcaPan=null;pcaCanvas.releasePointerCapture(e.pointerId);}};pcaCanvas.onpointercancel=()=>pcaPan=null;pcaCanvas.onauxclick=e=>e.preventDefault();pcaCanvas.onmousedown=e=>{if(e.button===1)e.preventDefault();};pcaCanvas.onclick=null;
const oldFind=document.getElementById('nz-ma-gene-find').onclick;document.getElementById('nz-ma-gene-find').onclick=()=>{if(state.graphType!=='pca'){oldFind();return;}const query=document.getElementById('nz-ma-gene-query').value.trim().toLowerCase(),p=pcaData(),s=p?.samples.find(s=>[s.id,s.gsm,s.name].filter(Boolean).some(v=>v.toLowerCase()===query));if(!s){showToast('No exact sample name found.');return;}pcaSelected=s.id;renderSamplePanel();drawPCA();};
maGeneQuery.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('nz-ma-gene-find').onclick();}};
const originalSearchInput=maGeneQuery.oninput;maGeneQuery.oninput=()=>{if(state.graphType==='pca'){if(!maGeneQuery.value.trim()){pcaSelected=null;renderSamplePanel();drawPCA();}}else originalSearchInput();};
const baseStatisticsBadge=updateStatisticsBadge;updateStatisticsBadge=()=>{if(state.graphType==='pca'){statBadge.className='nz-stat-badge';statBadge.textContent=pcaData()?'PCA current':'Calculate PCA';}else baseStatisticsBadge();};
requestAnimationFrame(()=>{scroll.scrollLeft=data.view?.trendScroll?.x||0;scroll.scrollTop=data.view?.trendScroll?.y||0;});

// This runs inside the existing explorer closure. Keep submitted results distinct.
const assaySummary=summary;
summary=(d,di,gi)=>{
  if(!d.result_only)return assaySummary(d,di,gi);
  if(state.hideNonsig&&sigInfo(d,gi).status==='not_significant')return null;
  if(!finite(d.original_effects[gi]))return null;
  return {mean:d.original_effects[gi],ave:d.original_aves?.[gi],members:[],ma:null,mb:null,nA:null,nB:null};
};
function supportsPlot(d,type){return d?.capabilities?.[type]!==false;}
function syncCapabilities(){
  for(const type of ['trend','ma','heatmap','pca']){const b=document.getElementById('nz-graph-'+type);b.disabled=!datasets.some(d=>supportsPlot(d,type));b.title=b.disabled?(datasets[state.maDatasetIndex]?.unsupported_reasons?.[type]||'This data does not support this plot.') : '';b.querySelector('.nz-disabled-label')?.remove();if(b.disabled)b.append(el('span','nz-disabled-label','Unavailable'));}
  const d=datasets[state.maDatasetIndex];
  document.getElementById('nz-pca-run').disabled=!supportsPlot(d,'pca');
  if(d?.result_only){statBadge.textContent='Submitted results';statBadge.title=d.partial_results?'Only the submitted subset of genes is available.':'Sample expression was not provided; statistics cannot be recalculated.';}
}
const assayRenderSide=renderSide;
renderSide=()=>{assayRenderSide();[...side.querySelectorAll('.nz-dataset')].slice(0,datasets.length).forEach((block,di)=>{const d=datasets[di],box=block.querySelector('.nz-gse-toggle');if(!supportsPlot(d,state.graphType)){box.disabled=true;block.append(el('div','nz-ma-disabled-note',d.unsupported_reasons?.[state.graphType]||'This data does not support this plot.'));}if(d.result_only){block.querySelector('strong').textContent=d.gse||d.label.match(/GSE\d+/)?.[0]||d.label;const text=d.data_type_label+(d.partial_results?' · submitted gene subset':'');block.append(el('div','nz-ma-disabled-note',text));block.querySelector('.nz-disclosure').hidden=true;}});syncCapabilities();};
const assayRenderAll=renderAll;
renderAll=()=>{if(state.graphType!=='trend'&&!supportsPlot(datasets[state.maDatasetIndex],state.graphType)){const next=datasets.findIndex(d=>supportsPlot(d,state.graphType));if(next>=0)state.maDatasetIndex=next;else state.graphType='trend';}assayRenderAll();syncCapabilities();};
const assaySwitchGraph=switchGraph;
switchGraph=type=>{if(!datasets.some(d=>supportsPlot(d,type))){showToast(datasets[state.maDatasetIndex]?.unsupported_reasons?.[type]||'This data does not support this plot.');type='trend';}if(type!=='trend'&&!supportsPlot(datasets[state.maDatasetIndex],type))state.maDatasetIndex=datasets.findIndex(d=>supportsPlot(d,type));assaySwitchGraph(type);syncCapabilities();};
document.getElementById('nz-graph-trend').onclick=()=>switchGraph('trend');
document.getElementById('nz-graph-ma').onclick=()=>switchGraph('ma');
document.getElementById('nz-graph-heatmap').onclick=()=>switchGraph('heatmap');
document.getElementById('nz-graph-pca').onclick=()=>switchGraph('pca');

// Compact graph selector and optional side panels.
const graphLayout=document.getElementById('nz-layout'),pathwayView=document.getElementById('nz-pathway-view');
let rightBeforePCA=false,pcaRightManaged=false;
function syncTrendBookmarks(){document.getElementById('nz-trend-bookmarks').hidden=false;document.querySelectorAll('[data-show-type]').forEach(button=>{const active=state.graphType==='trend'&&button.dataset.showType===state.showType;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
function changeTrendMode(mode){showTypeSelector.value=mode;showTypeSelector.onchange();syncTrendBookmarks();}
const compactSwitchGraph=switchGraph;
switchGraph=type=>{
 if(['ma','pca','heatmap'].includes(type)&&state.graphType==='trend'){let index=datasets.findIndex((d,di)=>d.dataset_id===state.lastSelectedDataset&&state.modes[di]!=='hidden'&&supportsPlot(d,type));if(index<0)index=datasets.findIndex((d,di)=>state.modes[di]!=='hidden'&&supportsPlot(d,type));if(index>=0)state.maDatasetIndex=index;}
 document.querySelectorAll('.nz-tooltip,.nz-ma-tip').forEach(t=>t.style.display='none');
 if(type==='heatmap'&&state.graphType!=='heatmap')heatmapNeedsCenter=true;
 if(type==='pca'&&state.graphType!=='pca')pcaViewport.initial=true;
 if(type==='ma'&&state.graphType!=='ma')state.maViewport={...state.maViewport,scale:1,panX:0,panY:0,initialRight:true};
 pathwayView.style.display=type==='pathway'?'flex':'none';
 document.querySelector('.nz-gene-list').style.display=type==='pathway'?'none':'';
 document.getElementById('nz-graph-pathway').classList.toggle('active',type==='pathway');
 document.getElementById('nz-graph-pathway').setAttribute('aria-pressed',String(type==='pathway'));
 if(type==='pathway'){
  state.graphType=type;for(const key of ['trend','ma','heatmap','pca']){const button=document.getElementById('nz-graph-'+key);button.classList.remove('active');button.setAttribute('aria-pressed','false');}
  for(const id of ['nz-scroll','nz-y-axis','nz-ma-view','nz-heatmap-view','nz-pca-view','nz-pca-settings','nz-ma-gene-search','nz-side-show'])document.getElementById(id).style.display='none';
  document.querySelector('.nz-right-significance').style.display='none';document.querySelector('.nz-stat-controls').style.display='none';
 }else{compactSwitchGraph(type);if(['ma','pca','heatmap'].includes(state.graphType)){state.modes=datasets.map((_,index)=>index===state.maDatasetIndex?state.showType:'hidden');state.lastSelectedDataset=datasets[state.maDatasetIndex]?.dataset_id;}}
 if(state.graphType==='pca'){if(!pcaRightManaged){rightBeforePCA=graphLayout.classList.contains('nz-right-hidden');pcaRightManaged=true;}graphLayout.classList.add('nz-right-hidden');document.getElementById('nz-toggle-right').hidden=true;ensurePCA(state.maDatasetIndex,Number(document.getElementById('nz-pca-top').value));}else if(pcaRightManaged){graphLayout.classList.toggle('nz-right-hidden',rightBeforePCA);document.getElementById('nz-toggle-right').hidden=false;pcaRightManaged=false;}requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
 parent.postMessage({type:'graph-controls',graph:state.graphType},location.origin);
 syncTrendBookmarks();
};
const compactRenderAll=renderAll;renderAll=()=>{if(state.graphType!=='pathway')compactRenderAll();syncTrendBookmarks();};
document.getElementById('nz-graph-trend').onclick=()=>{if(state.graphType==='trend'){const modes=['mean','points','both'];changeTrendMode(modes[(modes.indexOf(state.showType)+1)%modes.length]);}else switchGraph('trend');};
document.getElementById('nz-graph-pathway').onclick=()=>switchGraph('pathway');
document.querySelectorAll('[data-show-type]').forEach(button=>{button.onclick=()=>{switchGraph('trend');changeTrendMode(button.dataset.showType);};});
for(const sideName of ['left','right']){
 const button=document.getElementById('nz-toggle-'+sideName),panel=document.querySelector(sideName==='left'?'.nz-side':'.nz-gene-side'),hiddenClass='nz-'+sideName+'-hidden';let drag=null,suppress=false,lastWidth=sideName==='left'?215:185;
 function repaint(){const hidden=graphLayout.classList.contains(hiddenClass);button.textContent=sideName==='left'?(hidden?'▶':'◀'):(hidden?'◀':'▶');button.title=(hidden?'Show ':'Hide ')+sideName+' panel · Drag to resize';button.setAttribute('aria-expanded',String(!hidden));requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));}
 button.onclick=()=>{if(suppress){suppress=false;return;}const hiding=!graphLayout.classList.contains(hiddenClass);if(hiding)lastWidth=panel.getBoundingClientRect().width;graphLayout.classList.toggle(hiddenClass,hiding);graphLayout.style.setProperty('--'+sideName+'-width',(hiding?0:lastWidth)+'px');repaint();};
 button.onpointerdown=e=>{if(e.button!==0)return;drag={x:e.clientX,width:graphLayout.classList.contains(hiddenClass)?0:panel.getBoundingClientRect().width,moved:false};button.setPointerCapture(e.pointerId);e.preventDefault();};
 button.onpointermove=e=>{if(!drag)return;const delta=(e.clientX-drag.x)*(sideName==='left'?1:-1);if(Math.abs(delta)>3)drag.moved=true;if(!drag.moved)return;const other=document.querySelector(sideName==='left'?'.nz-gene-side':'.nz-side').getBoundingClientRect().width,max=Math.max(120,Math.min(260,graphLayout.clientWidth-other-300-20)),raw=drag.width+delta,hidden=raw<100,width=hidden?0:Math.max(120,Math.min(max,raw));graphLayout.classList.toggle(hiddenClass,hidden);graphLayout.style.setProperty('--'+sideName+'-width',width+'px');if(!hidden)lastWidth=width;repaint();};
 button.onpointerup=e=>{if(!drag)return;suppress=drag.moved;drag=null;if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);setTimeout(()=>suppress=false,0);};button.onpointercancel=()=>{drag=null;};repaint();
}


const countdown=document.createElement('div');countdown.className='nz-countdown-cursor';countdown.hidden=true;countdown.innerHTML='<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#d9e2ed" stroke-width="3"/><circle class="progress" cx="16" cy="16" r="12" fill="none" stroke="#b74654" stroke-width="3" stroke-linecap="round" transform="rotate(-90 16 16)" stroke-dasharray="75.4" stroke-dashoffset="75.4"/></svg>';document.body.append(countdown);
let cursorDeadline=0,cursorX=innerWidth/2,cursorY=innerHeight/2;
document.addEventListener('pointermove',e=>{cursorX=e.clientX;cursorY=e.clientY;countdown.style.left=cursorX+'px';countdown.style.top=cursorY+'px';});
function notifySelectionChange(){const changed=datasets.some((d,di)=>!d.no_contrast&&d.samples.some((s,si)=>state.checked[di][si]!==d.included.includes(s.id)));cursorDeadline=changed?Date.now()+3000:0;countdown.hidden=!changed;document.body.classList.toggle('nz-counting',changed);parent.postMessage({type:'sample-selection-changed',selections:captureView().view.selected_samples},location.origin);}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=='recalc-countdown')return;cursorDeadline=e.data.deadline||0;countdown.hidden=!cursorDeadline;document.body.classList.toggle('nz-counting',!!cursorDeadline);});
function animateCountdown(){if(cursorDeadline){const t=Math.max(0,Math.min(1,1-(cursorDeadline-Date.now())/3000)),f=.25*t+.75*(t**4/(t**4+(1-t)**4));countdown.querySelector('.progress').setAttribute('stroke-dashoffset',String(75.4*(1-f)));countdown.style.left=cursorX+'px';countdown.style.top=cursorY+'px';}requestAnimationFrame(animateCountdown);}animateCountdown();
restoreView(data.view);datasets.forEach((_,di)=>updateStatisticsState(di));updateSignificanceControls();switchGraph(state.graphType);lastSaved=JSON.stringify(captureView());setInterval(checkView,300);if(state.graphType==='ma')await drawMA();api('viewer_receipt',{revision:localRevision,plot:state.graphType}).catch(()=>{});parent.postMessage({type:'viewer-ready',dataRevision:data.data_revision},location.origin);for(let di=0;di<datasets.length;di++)await ensurePCA(di,di===state.maDatasetIndex?Number(document.getElementById('nz-pca-top').value):500);
})();
