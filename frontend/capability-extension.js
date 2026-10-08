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
renderSide=()=>{assayRenderSide();[...side.querySelectorAll('.nz-dataset')].slice(0,datasets.length).forEach((block,di)=>{const d=datasets[di],box=block.querySelector('.nz-gse-toggle');if(!supportsPlot(d,state.graphType)){box.disabled=true;block.append(el('div','nz-ma-disabled-note',d.unsupported_reasons?.[state.graphType]||'This data does not support this plot.'));}if(d.result_only){block.querySelector('strong').textContent=d.label;const text=d.data_type_label+(d.partial_results?' · submitted gene subset':'');block.append(el('div','nz-ma-disabled-note',text));block.querySelector('.nz-disclosure').hidden=true;}});syncCapabilities();};
const assayRenderAll=renderAll;
renderAll=()=>{if(state.graphType!=='trend'&&!supportsPlot(datasets[state.maDatasetIndex],state.graphType)){const next=datasets.findIndex(d=>supportsPlot(d,state.graphType));if(next>=0)state.maDatasetIndex=next;else state.graphType='trend';}assayRenderAll();syncCapabilities();};
const assaySwitchGraph=switchGraph;
switchGraph=type=>{if(!datasets.some(d=>supportsPlot(d,type))){showToast(datasets[state.maDatasetIndex]?.unsupported_reasons?.[type]||'This data does not support this plot.');type='trend';}if(type!=='trend'&&!supportsPlot(datasets[state.maDatasetIndex],type))state.maDatasetIndex=datasets.findIndex(d=>supportsPlot(d,type));assaySwitchGraph(type);syncCapabilities();};
document.getElementById('nz-graph-trend').onclick=()=>switchGraph('trend');
document.getElementById('nz-graph-ma').onclick=()=>switchGraph('ma');
document.getElementById('nz-graph-heatmap').onclick=()=>switchGraph('heatmap');
document.getElementById('nz-graph-pca').onclick=()=>switchGraph('pca');
