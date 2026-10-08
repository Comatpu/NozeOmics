"""Extract the reviewed v60 renderer; fail loudly if its source changes."""
from pathlib import Path
import re
import shutil

root=Path(__file__).resolve().parents[1]
source=root.parent/'outputs/cell_05_meta_analysis_heatmap_v60.py'
text=source.read_text(encoding='utf-8')
html=text.split("return r'''<!doctype html>",1)[1].split("'''.replace('__PAYLOAD__', safe_payload)",1)[0]
html='<!doctype html>'+html
script=html.split('<script>\n',1)[1].split('</script>',1)[0]
html=html.split('<script>\n',1)[0]+'<script src="bootstrap.js"></script><script src="explorer.js"></script></body></html>'
html=html.replace('<script type="application/json" id="nz-data">__PAYLOAD__</script>','')
html=html.replace('<h2>Gene-expression explorer</h2>','<h2 id="nz-comparison-name">Expression explorer</h2>')
html=html.replace('</style>','\n.nz-graph-options{grid-template-columns:repeat(2,minmax(0,1fr))}.nz-layout{min-height:0}.nz-side,.nz-main,.nz-gene-side{height:calc(100vh - 68px);min-height:620px}.nz-app{padding:12px 16px}.nz-pca-view{height:100%;display:none;position:relative}.nz-pca-canvas{width:100%;height:100%;display:block;cursor:default}.nz-pca-settings{display:none;padding:8px 12px;border-bottom:1px solid #e6edf5;font-size:12px}.nz-pca-settings select{max-width:100%;font-size:12px}.nz-gene-row.selected{background:#e7f2ff}.nz-sample.nz-excluded input{position:static;opacity:1;pointer-events:auto}\n</style>')
pca_button='<button type="button" class="nz-graph-option" id="nz-graph-pca" aria-pressed="false"><svg viewBox="0 0 85 48" aria-hidden="true"><path d="M5 42H80M5 5V42" fill="none" stroke="#9aafc3"/><g fill="#2563a5"><circle cx="22" cy="30" r="3"/><circle cx="27" cy="34" r="3"/><circle cx="33" cy="29" r="3"/></g><g fill="#dc6b26"><circle cx="56" cy="16" r="3"/><circle cx="64" cy="21" r="3"/><circle cx="69" cy="13" r="3"/></g></svg>PCA</button>'
html=html.replace('Heatmap</button></div>','Heatmap</button>'+pca_button+'</div>')
html=html.replace('<div class="nz-side-show', '<div class="nz-pca-settings" id="nz-pca-settings">Features <select id="nz-pca-top"><option value="500">Most variable 500</option><option value="1000">Most variable 1000</option><option value="2000">Most variable 2000</option><option value="0">All eligible genes</option></select><button class="nz-btn" id="nz-pca-run">Calculate PCA</button></div><div class="nz-side-show',1)
html=html.replace('<div id="nz-footer"','<div class="nz-pca-view" id="nz-pca-view"><canvas class="nz-pca-canvas" id="nz-pca-canvas"></canvas><div class="nz-ma-tip" id="nz-pca-tip"></div></div><div id="nz-footer"')
script=script.replace('(()=>{','(async()=>{',1)
script=script.replace("const data=JSON.parse(document.getElementById('nz-data').textContent)","const data=await api('payload',{},true)",1)
script=script.replace("const originalSignificance=", "async function api(method,args={},read=false){const response=await fetch('/api/'+method,{method:read?'GET':'POST',headers:{Authorization:'Bearer '+NOZEOMICS.token,'Content-Type':'application/json'},body:read?undefined:JSON.stringify(args)});const result=await response.json();if(!response.ok){const error=new Error(result.error?.message||'Request failed');error.code=result.error?.code;throw error;}return result;}\nconst originalSignificance=",1)
script=script.replace("checked:datasets.map(d=>d.samples.map(()=>true))","checked:datasets.map(d=>d.samples.map(s=>d.included.includes(s.id)))",1)
script=script.replace("function summary(d,di,gi){", "function summary(d,di,gi){",1)
script=script.replace("return {mean:mb-ma,ave:mean([...a,...b])", "return {mean:!state.statsDirty[di]&&d.statistics_current&&finite(d.original_effects[gi])?d.original_effects[gi]:mb-ma,ave:mean([...a,...b])",1)
script=script.replace("ave:mean([...a,...b])","ave:!state.statsDirty[di]&&d.statistics_current&&finite(d.original_aves?.[gi])?d.original_aves[gi]:mean([...a,...b])",1)
script=script.replace("['values','codes','original_effects','significance']","['values','codes','original_effects','original_aves','significance']")
script=script.replace("effect:active?.[2]??null,significance:sig(active)","effect:active?.[2]??null,ave:active?.[1]??null,significance:sig(active)")
script=script.replace("d.original_effects.push(record.effect);","d.original_effects.push(record.effect);d.original_aves.push(record.ave);")
a=script.index('function updateStatisticsState(');b=script.index('function updateStatisticsBadge(',a)
script=script[:a]+"function updateStatisticsState(di){const d=datasets[di];state.statsDirty[di]=!d.statistics_current||!d.samples.every((s,si)=>state.checked[di][si]===d.included.includes(s.id));updateStatisticsBadge();}\n"+script[b:]
script=script.replace("else statBadge.textContent='Original';","else statBadge.textContent='Current';")
script=script.replace("for(const group of ['Group A','Group B'])","for(const group of ['Group A','Group B','N/A'])")
script=script.replace("block.append(el('div','nz-group',group));","block.append(el('div','nz-group',group==='Group A'?(d.a_label||group):group==='Group B'?(d.b_label||group):'Other samples'));")
old="if(box.checked&&excludedByRecalculation){const restore=window.confirm('Roll back P.Value and adj.P.Val to the original full-sample analysis?');if(!restore){box.checked=false;return;}rollbackDataset(di);renderAll();return;}"
assert old in script
script=script.replace(old,'')
script=script.replace("function renderGenePanel(){", "function renderGenePanel(){if(state.graphType==='pca'){renderSamplePanel();return;}",1)
script=script.replace("function sigInfo(d,gi){", "function sigInfo(d,gi){if(state.statsDirty[datasets.indexOf(d)])return {p_value:null,adj_p:null,status:'unavailable'};",1)
a=script.index('function findColabBridge(');b=script.index('function renderActiveGraph(',a)
script=script[:a]+"async function recalculateStatistics(){if(state.statsRunning)return;try{await saveView();for(let di=0;di<datasets.length;di++){if(state.graphType!=='trend'?di!==state.maDatasetIndex:state.modes[di]==='hidden')continue;const d=datasets[di];if(d.no_contrast)throw new Error('Set a Group A/B comparison with your AI first.');const response=await api('start_analysis',{comparison_id:d.dataset_id,kind:'differential',base_revision:localRevision,request_id:crypto.randomUUID()});localRevision=response.revision;}state.statsRunning=true;updateStatisticsBadge();showToast('Analysis started. The design and original counts are retained.');parent.postMessage({type:'workspace-saved'},location.origin);}catch(e){showToast(e.message);}}\n"+script[b:]
script=script.replace("function renderActiveGraph(){if(state.graphType==='ma')", "function renderActiveGraph(){if(state.graphType==='pca')drawPCA();else if(state.graphType==='ma')",1)
script=script.replace("if(selected.every(Boolean))return {points:d.ma_points,outdated:false};", "if(!state.statsDirty[di]&&d.statistics_current)return {points:d.ma_points,outdated:false};",1)
script=script.replace("['trend','ma','heatmap']","['trend','ma','heatmap','pca']")
script=script.replace("state.graphType=type;for", "state.graphType=type;document.getElementById('nz-pca-view').style.display=type==='pca'?'block':'none';document.getElementById('nz-pca-settings').style.display=type==='pca'?'block':'none';recalculateButton.style.display='none';document.getElementById('nz-pca-run').disabled=false;for",1)
script=script.replace("type==='heatmap'?'none':'flex'", "['heatmap','pca'].includes(type)?'none':'flex'",1)
script=script.replace("type==='ma'?'flex':'none'", "['ma','pca'].includes(type)?'flex':'none'",1)
script=script.replace("state.graphType=type;document", "state.graphType=type;document.getElementById('nz-ma-gene-query').placeholder=type==='pca'?'Exact sample name':'Exact gene name';document.getElementById('nz-ma-gene-query').setAttribute('aria-label',type==='pca'?'Find sample in PCA':'Find gene in MA plot');document",1)
script=script.replace("window.addEventListener('resize',()=>{if(state.graphType==='ma')drawMA();});", "window.addEventListener('resize',()=>{if(state.graphType==='ma')drawMA();else if(state.graphType==='pca')drawPCA();});")
script=script.replace("updateSignificanceControls();\nrenderAll();", "restoreView(data.view);datasets.forEach((_,di)=>updateStatisticsState(di));updateSignificanceControls();switchGraph(state.graphType);lastSaved=JSON.stringify(captureView());setInterval(checkView,300);if(state.graphType==='ma')await drawMA();api('viewer_receipt',{revision:localRevision,plot:state.graphType}).catch(()=>{});")
extension=(root/'frontend/local-extension.js').read_text(encoding='utf-8')
script=script.replace("updateSignificanceControls();\nrenderAll();", "updateSignificanceControls();\nrenderAll();")
insert=script.index('restoreView(data.view);')
script=script[:insert]+extension+'\n'+script[insert:]
(root/'frontend/explorer.html').write_text(html,encoding='utf-8')
(root/'frontend/explorer.js').write_text(script,encoding='utf-8')
(root/'docs').mkdir(exist_ok=True)
shutil.copy2(source,root/'docs/cell5-v60-reference.py')
print('Extracted Cell 5 v60 into the local viewer.')

# Automatic significance updates are coordinated by the local shell.
p=root/"frontend/explorer.js"
s=p.read_text(encoding="utf-8").replace("state.checked[di][si]=box.checked;", "state.checked[di][si]=box.checked;parent.postMessage({type:\"sample-selection-changed\"},location.origin);")
p.write_text(s,encoding="utf-8")
import runpy
runpy.run_path(str(root/'scripts/update_capabilities.py'))
