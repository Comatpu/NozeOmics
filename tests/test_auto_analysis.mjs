import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let handler,time=10000,loads=[],messages=[];
const frame={contentWindow:{postMessage:m=>messages.push(m)}};
const label={},bar={removeAttribute(){}};
const box={querySelector:s=>s==='span'?label:bar,setAttribute(){}};
const state={project:{id:'p',stage:'analysis',comparisons:{c:{id:'c',included:['a','b'],result_selection:['a','b']}}},jobs:[]};
const context=vm.createContext({Map,JSON,Date:{now:()=>time,parse:Date.parse},snapshot:state,document:{createElement:()=>box,querySelector:()=>({append(){}})},window:{addEventListener:(_,h)=>handler=h},location:{origin:'local'},$:()=>frame,setInterval(){},setAnalysisLoading:v=>loads.push(v),toast(){}});
vm.runInContext(fs.readFileSync('frontend/auto-analysis.js','utf8'),context);
const run=s=>vm.runInContext(s,context);
run('observeAutoAnalysis(snapshot)');
function change(ids){handler({origin:'local',source:frame.contentWindow,data:{type:'sample-selection-changed',selections:{c:ids}}});}
change(['a']);assert.equal(run('autoDeadline'),13000);assert.equal(run('autoPending.size'),1);
time=11000;change(['a','b']);assert.equal(run('autoPending.size'),0);assert.equal(messages.at(-1).deadline,0);
state.project.comparisons.c.included=['a'];run('observeAutoAnalysis(snapshot)');assert.equal(run('autoPending.size'),0,'Stale saved selection must not restart cancelled countdown');
time=12000;change(['b']);assert.equal(run('autoDeadline'),15000);
state.jobs=[{project_id:'p',kind:'differential',status:'running'}];run('paintAutoAnalysis()');assert.equal(loads.at(-1),true);
state.jobs=[];run('paintAutoAnalysis()');assert.equal(loads.at(-1),true,'Keep loading screen up until refreshed viewer is ready');
console.log('PASS: 3-second reset, immediate cancellation, stale snapshot protection and uninterrupted loading.');

state.project.data_revision=0;run('window.analysisRecalcActive=true;window.analysisRecalcBaseRevision=0;window.analysisLoadedDataRevision=0');assert.equal(run('keepRecalculationLoading()'),true,'Stale idle snapshot cannot dismiss loading');state.project.data_revision=1;assert.equal(run('keepRecalculationLoading()'),true,'Wait for updated viewer');run('window.analysisLoadedDataRevision=1');assert.equal(run('keepRecalculationLoading()'),false);console.log('PASS: Loading remains latched through stale snapshots until new result viewer is ready.');
