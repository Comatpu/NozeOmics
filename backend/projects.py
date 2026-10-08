from __future__ import annotations

import base64
import copy
import gzip
import json
import os
import re
import shutil
import sys
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

from .common import VERSION, Problem, atomic_json, clean, default_panel, digest, encoded, file_hash, now, read_json, species_name
from . import imports, engine
from .data_types import classification
from .intake import Intake
from .result_tables import ResultTables


class Workspace(Intake, ResultTables):
    def __init__(self, root, home):
        self.root, self.home = Path(root).resolve(), Path(home).resolve()
        self.home.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.source_pool = ThreadPoolExecutor(max_workers=1)
        self.cancels, self.processes, self.matrix_cache, self.payload_cache = {}, {}, {}, {}
        self.state = read_json(self.home/'workspace.json', {'schema': 1, 'revision': 0, 'active_project': None, 'projects': {}, 'jobs': {}, 'receipts': [], 'operations': {}})
        for job in self.state['jobs'].values():
            if job['status'] in {'queued', 'running'}:
                job.update(status='interrupted', error={'code': 'interrupted', 'message': 'The program stopped before this job completed.'})
        for p in self.state['projects'].values():
            for e in p.get('intake', {}).values():
                for f in e.get('files', []):
                    if f['status'] in {'queued', 'downloading', 'pending'}:
                        f.update(status='not_downloaded', selected=False)
                        e['phase'] = 'Waiting for AI review'
                if e['status'] == 'fetching':
                    e.update(status='returned', reason='Retrieval was interrupted. Retry this GSE to resume cached downloads.', phase='Retrieval interrupted')
            if p.get('stage') == 'processing':
                p['stage'] = 'intake'
                for e in p.get('intake', {}).values():
                    if e['status'] == 'approved':
                        e.update(status='awaiting_review', phase='Resume with AI review after interruption')
        self.save()

    def save(self):
        atomic_json(self.home/'workspace.json', self.state)

    def project(self, pid=None):
        pid = pid or self.state['active_project']
        if not pid or pid not in self.state['projects']:
            raise Problem('project_required', 'Open or create a project first.')
        return self.state['projects'][pid]

    def folder(self, pid=None):
        return self.home/'projects'/self.project(pid)['id']

    def mutate(self, base=None):
        if base is not None and base != self.state['revision']:
            raise Problem('revision_conflict', 'The project changed in the program or another AI session. Read its current state and retry.', {'revision': self.state['revision']})
        self.state['revision'] += 1
        self.payload_cache.clear()

    def snapshot(self):
        with self.lock:
            p = self.state['projects'].get(self.state['active_project'])
            result = {'version': VERSION, 'revision': self.state['revision'], 'active_project': self.state['active_project'], 'projects': [{'id': v['id'], 'name': v['name'], 'organism': v.get('organism'), 'comparisons': len(v['comparisons']), 'datasets': len(v['datasets']), 'stage': v.get('stage', 'analysis' if v['datasets'] else 'intake'), 'created': v.get('created'), 'gse_count': len([e for e in v.get('intake', {}).values() if e['status'] != 'excluded']) or len({d['gse'] for d in v['datasets'].values()})} for v in self.state['projects'].values()], 'jobs': list(self.state['jobs'].values())[-30:], 'viewer_receipts': self.state['receipts'][-5:]}
            if p:
                result['project'] = copy.deepcopy(p)
                result['project']['datasets'] = [{k: v for k, v in d.items() if k not in {'features', 'samples', 'recipe'}} for d in p['datasets'].values()]
                for d in result['project']['datasets']:
                    if not d.get('data_type'):
                        d.update(classification(d['unit']))
                result['project']['path'] = str(self.folder())
                result['project']['stage'] = p.get('stage', 'analysis' if p['datasets'] else 'intake')
            return clean(result)

    def open_project(self, name=None, project_id=None, base_revision=None, workflow=None, **_):
        with self.lock:
            if project_id and project_id not in self.state['projects']:
                raise Problem('project_missing', 'Unknown project ID.')
            self.mutate(base_revision)
            if not project_id:
                project_id = str(uuid.uuid4())
                self.state['projects'][project_id] = {'id': project_id, 'name': str(name or 'Untitled project'), 'organism': None, 'created': now(), 'datasets': {}, 'comparisons': {}, 'panel': default_panel('Homo sapiens'), 'panel_name': 'Human_default_panel', 'view': {'graphType': 'trend'}, 'data_revision': 0, 'stage': 'intake' if workflow == 'intake' else 'analysis', 'intake': {}}
                self.folder(project_id).mkdir(parents=True, exist_ok=True)
            self.state['active_project'] = project_id
            self.save()
            return self.snapshot()

    def prepare_import(self, **_):
        p = self.project()
        work = self.folder()/'staging'/str(uuid.uuid4())
        work.mkdir(parents=True, exist_ok=True)
        python = self.root/'runtime/python/python.exe'
        return {'staging_path': str(work), 'python': str(python if python.exists() else Path(sys.executable)), 'python_version': sys.version.split()[0], 'schema': 'genes_by_samples', 'recipe_units': sorted(imports.UNITS), 'requirements': 'Retain original numeric values and feature identifiers; supply unique sample IDs, verified mapping and source/locator/value evidence.'}

    def inspect_source(self, path=None, gse=None, offset=0, limit=20, **_):
        if gse:
            metadata = imports.geo_metadata(gse)
            target = self.folder()/'sources'/(gse+'.soft')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(metadata.pop('raw_text'), encoding='utf-8')
            atomic_json(target.with_suffix('.json'),metadata)
            keys={'Sample_title','Sample_organism_ch1','Sample_source_name_ch1','Sample_characteristics_ch1','Sample_description','Sample_supplementary_file_1'}
            selected=metadata['samples'][max(0,int(offset)):max(0,int(offset))+max(1,min(100,int(limit)))]
            result={'gse':gse,'saved_source':str(target),'saved_metadata_json':str(target.with_suffix('.json')),'total_samples':len(metadata['samples']),'offset':offset,'series':{k:v for k,v in metadata['series'].items() if k in {'Series_title','Series_summary','Series_overall_design','Series_supplementary_file'}},'processing_example':metadata['samples'][0]['fields'].get('Sample_data_processing',[]),'samples':[dict(gsm=s['gsm'],fields={k:v for k,v in s['fields'].items() if k in keys},aliases=s['aliases']) for s in selected]}
            return result
        return imports.inspect_file(path)

    def fetch_source(self, url, filename=None, **_):
        name = Path(filename or url.split('/')[-1]).name
        if not name or name in {'.', '..'}:
            raise Problem('filename_required', 'Supply a simple filename.')
        return imports.download(url, self.folder()/'sources'/name)

    def import_dataset(self, path, organism=None, gse=None, tissue=None, recipe=None, samples=None, label=None, legacy=False, adapter_path=None, base_revision=None, study_info=None, **_):
        pid = self.project()['id']
        folder = self.folder(pid)
        original = Path(path).resolve()
        old = imports.legacy(original) if legacy else None
        if old:
            matrix, ids, symbols, sample_records, annotation = old['matrix'], old['ids'], old['symbols'], old['samples'], None
            organism, gse, unit = old['organism'], old['gse'], old['unit']
        else:
            recipe = dict(recipe or {})
            unit = recipe.get('unit')
            matrix, ids, symbols, sample_records, annotation = imports.extract(original, recipe, samples or [], organism, self.home/'annotation')
            organism = species_name(organism)
        with self.lock:
            p = self.project(pid)
            if p['organism'] and p['organism'] != organism:
                raise Problem('mixed_species', 'Use a separate project for human and mouse datasets.')
            self.mutate(base_revision)
            did = str(uuid.uuid4())
            dest = folder/'datasets'/did
            dest.mkdir(parents=True, exist_ok=True)
            source = dest/('source-'+original.name)
            shutil.copy2(original, source)
            np.savez_compressed(dest/'assay.npz', matrix=matrix)
            symbol_counts = pd.Series(symbols).value_counts().to_dict()
            features = [{'id': gid, 'symbol': sym, 'display_name': sym if sym and symbol_counts.get(sym, 0) == 1 else f'{sym} [{gid}]' if sym else gid} for gid, sym in zip(ids, symbols)]
            data = {'id': did, 'label': label or gse or original.stem, 'gse': gse or 'Imported', 'organism': organism, 'tissue': tissue or '', 'unit': unit, 'samples': sample_records, 'features': features, 'rows': len(ids), 'columns': len(sample_records), 'source': str(source), 'source_sha256': file_hash(source), 'imported': now(), 'recipe': recipe or {'legacy_workbook': True}, 'annotation': annotation, 'legacy': bool(legacy)}
            data.update(classification(unit))
            if adapter_path:
                adapter = Path(adapter_path).resolve()
                shutil.copy2(adapter, dest/'adapter.py')
                data['adapter_sha256'] = file_hash(adapter)
            data['study_info']={k:str(v) for k,v in (study_info or {}).items() if k in {'drug','drug_description','suitability','note'}}
            atomic_json(dest/'manifest.json', data)
            p['datasets'][did] = data
            if not p['organism']:
                p['organism'] = organism
                if p['panel_name'].endswith('_default_panel'):
                    p['panel'] = default_panel(organism)
                    p['panel_name'] = ('Human' if organism == 'Homo sapiens' else 'Mouse') + '_default_panel'
            p['data_revision'] += 1
            self.save()
            if old:
                groups = {s['id']: s['group'] for s in sample_records}
                comp = self.configure_comparison(dataset_id=did, groups=groups, label=label or data['label'])['comparison']
                runid = str(uuid.uuid4())
                runfolder = folder/'runs'/runid
                runfolder.mkdir(parents=True)
                old['results'].to_csv(runfolder/'results.tsv', sep='\t', index=False)
                logged = matrix if unit == 'log2' else np.log2(matrix+0.1)
                selected_indices=[i for i,s in enumerate(sample_records) if s['id'] in comp['included']]
                np.savez_compressed(runfolder/'expression.npz', matrix=logged[:,selected_indices])
                self.project(pid)['comparisons'][comp['id']].update(run_id=runid, result_selection=comp['included'], method='Submitted legacy results', result_spec_hash=digest(comp['spec']))
                atomic_json(runfolder/'manifest.json', {'method': 'Submitted legacy results', 'source_report': old['report'], 'original_counts_available': False, 'sample_ids': comp['included'], 'spec': comp['spec']})
                p['data_revision'] += 1
                self.save()
            return {'dataset': {'id': did, 'gse': data['gse'], 'rows': len(ids), 'samples': len(sample_records), 'unit': unit, 'annotation': annotation}, 'revision': self.state['revision']}

    def configure_comparison(self, dataset_id, groups, label=None, a_label='Control', b_label='Treatment', blocking_fields=None, base_revision=None, **_):
        with self.lock:
            p = self.project()
            d = p['datasets'].get(dataset_id)
            if not d:
                raise Problem('dataset_missing', 'Unknown dataset ID.')
            all_ids = {s['id'] for s in d['samples']}
            if set(groups) - all_ids or any(v not in {'Group A', 'Group B', 'N/A'} for v in groups.values()):
                raise Problem('invalid_groups', 'Use existing sample IDs and Group A, Group B or N/A assignments.')
            included = [s['id'] for s in d['samples'] if groups.get(s['id'], 'N/A') in {'Group A', 'Group B'}]
            if not included:
                raise Problem('empty_comparison', 'Include at least one sample, or use a dataset PCA before differential analysis.')
            tissues = {s.get('tissue') for s in d['samples'] if s['id'] in included and s.get('tissue')}
            if len(tissues) > 1:
                raise Problem('mixed_tissues', 'Select one tissue for each comparison.')
            fields = list(dict.fromkeys(blocking_fields or []))
            if any(not re.fullmatch('[A-Za-z][A-Za-z0-9_]*', field) or field in {'id','group','condition'} for field in fields):
                raise Problem('invalid_design', 'Use simple existing sample metadata fields.')
            self.mutate(base_revision)
            cid = str(uuid.uuid4())
            spec = {'dataset_id': dataset_id, 'groups': groups, 'blocking_fields': fields, 'included': included}
            comp = {'id': cid, 'dataset_id': dataset_id, 'label': label or f"{d['gse']} · {a_label} vs {b_label}", 'a_label': a_label, 'b_label': b_label, 'samples': included.copy(), 'included': included.copy(), 'spec': spec, 'run_id': None, 'method': None}
            p['comparisons'][cid] = comp
            p['data_revision'] += 1
            p['view']['maDatasetId'] = cid
            self.save()
            return {'comparison': copy.deepcopy(comp), 'revision': self.state['revision']}

    def update_view(self, view=None, panel=None, panel_name=None, base_revision=None, request_id=None, project_id=None, **_):
        with self.lock:
            operation_hash=digest({'method':'update_view','view':view,'panel':panel,'panel_name':panel_name,'project_id':project_id or self.state['active_project']})
            if request_id and request_id in self.state['operations']:
                if self.state['operations'][request_id].get('request_hash')!=operation_hash:
                    raise Problem('request_id_reused','Use a new request ID for a different operation.')
                return self.state['operations'][request_id]
            p = self.project()
            if project_id and project_id!=p['id']:
                raise Problem('project_changed','Another project is now open; refresh the viewer before editing.')
            if panel is not None:
                if len(panel) > 3000 or any(not isinstance(g, str) or not g.strip() for g in panel) or len(set(g.lower() for g in panel)) != len(panel):
                    raise Problem('invalid_panel', 'Gene symbols must be nonblank and unique; maximum 3000 genes.')
            # Validate all sample updates before changing any persisted state.
            for cid, selection in (view or {}).get('selected_samples', {}).items():
                if cid not in p['comparisons'] or set(selection) - set(p['comparisons'][cid]['samples']) or len(set(selection)) != len(selection):
                    raise Problem('invalid_selection', 'Sample selection contains unknown or duplicate IDs.')
            for did,selection in (view or {}).get('dataset_selected_samples',{}).items():
                d=p['datasets'].get(did)
                if not d or set(selection)-{s['id'] for s in d['samples']} or len(selection)!=len(set(selection)):
                    raise Problem('invalid_selection','Dataset PCA selection contains unknown or duplicate IDs.')
            self.mutate(base_revision)
            if panel is not None:
                p['panel'] = [g.strip() for g in panel]
                if panel_name:
                    p['panel_name'] = panel_name
            if view:
                allowed = {'graphType', 'showType', 'cutoffIndex', 'significanceMetric', 'hideNonsig', 'hiddenGenes', 'modes', 'collapsed', 'maDatasetId', 'maViewport', 'heatmapScale', 'maSearchName', 'selected_samples','dataset_selected_samples', 'pcaTop', 'trendScroll'}
                p['view'].update({k: copy.deepcopy(v) for k,v in view.items() if k in allowed})
                for cid, selection in view.get('selected_samples', {}).items():
                    p['comparisons'][cid]['included'] = selection.copy()
                    p['comparisons'][cid]['spec']['included'] = selection.copy()
                for did,selection in view.get('dataset_selected_samples',{}).items():
                    p['datasets'][did]['included']=selection.copy()
            self.save()
            response = {'revision': self.state['revision'], 'view': copy.deepcopy(p['view']), 'panel': p['panel'].copy(), 'request_hash':operation_hash}
            if request_id:
                self.state['operations'][request_id] = response
                self.state['operations'] = dict(list(self.state['operations'].items())[-100:])
                self.save()
            return response

    def assay(self, pid, did):
        key = (pid, did)
        if key not in self.matrix_cache:
            with np.load(self.folder(pid)/'datasets'/did/'assay.npz', allow_pickle=False) as loaded:
                self.matrix_cache[key] = loaded['matrix']
        return self.matrix_cache[key]

    def start_analysis(self, comparison_id=None, dataset_id=None, kind='differential', n_top=500, base_revision=None, request_id=None, **_):
        with self.lock:
            operation_hash=digest({'method':'start_analysis','comparison_id':comparison_id,'dataset_id':dataset_id,'kind':kind,'n_top':n_top})
            if request_id and request_id in self.state['operations']:
                if self.state['operations'][request_id].get('request_hash')!=operation_hash:
                    raise Problem('request_id_reused','Use a new request ID for a different analysis request.')
                return self.state['operations'][request_id]
            if kind not in {'differential','pca'}:
                raise Problem('invalid_analysis', 'Choose differential or pca.')
            if n_top not in {0, 500, 1000, 2000}:
                raise Problem('pca_features', 'Choose 500, 1000, 2000 or 0 for all eligible genes.')
            p = self.project()
            comp = p['comparisons'].get(comparison_id) if comparison_id else None
            if comparison_id and not comp:
                raise Problem('comparison_missing', 'Unknown comparison.')
            if kind == 'differential' and not comp:
                raise Problem('comparison_required', 'Set the A/B comparison first.')
            dataset_id = comp['dataset_id'] if comp else dataset_id
            d = p['datasets'].get(dataset_id)
            if not d:
                raise Problem('dataset_missing', 'Unknown dataset.')
            ids = comp['included'] if comp else d.get('included',[s['id'] for s in d['samples']])
            if d.get('result_only'):
                raise Problem('unsupported_analysis', 'Submitted results have no sample expression values for recalculation or PCA.')
            if p.get('stage') == 'intake':
                raise Problem('ai_review_required', 'The intake batch must pass AI review before analysis starts.')
            samples = [dict(s, group=comp['spec']['groups'].get(s['id'],'N/A')) if comp else dict(s, group=s.get('group','N/A')) for s in d['samples'] if s['id'] in ids]
            tissues = {s.get('tissue') for s in samples if s.get('tissue')}
            if len(tissues) > 1:
                raise Problem('mixed_tissues', 'PCA and differential analysis must use one tissue cohort.')
            if any(s.get('biological_replicate') is False for s in samples):
                raise Problem('technical_replicates', 'Resolve technical replicates before analysis.')
            snapshot = {'project_id': p['id'], 'dataset_id': dataset_id, 'comparison_id': comparison_id, 'kind': kind, 'samples': samples, 'spec': copy.deepcopy(comp['spec']) if comp else {'dataset_id':dataset_id,'included':ids.copy()}, 'source_sha256': d['source_sha256'], 'n_top': n_top, 'unit': d['unit']}
            self.mutate(base_revision)
            jobid = str(uuid.uuid4())
            job = {'id': jobid, 'project_id': p['id'], 'kind': kind, 'comparison_id': comparison_id, 'dataset_id': dataset_id, 'status': 'queued', 'started': now(), 'phase': 'Preparing input', 'input_hash': digest(snapshot)}
            self.state['jobs'][jobid] = job
            self.cancels[jobid] = threading.Event()
            self.save()
            answer = {'job': copy.deepcopy(job), 'revision': self.state['revision'], 'request_hash':operation_hash}
            if request_id:
                self.state['operations'][request_id] = answer
                self.save()
            self.pool.submit(self._calculate, jobid, snapshot)
            return answer

    def _calculate(self, jid, snapshot):
        try:
            pid, did, samples = snapshot['project_id'], snapshot['dataset_id'], snapshot['samples']
            with self.lock:
                job = self.state['jobs'][jid]
                job.update(status='running', phase='Normalizing expression' if snapshot['kind']=='pca' else 'Fitting the statistical model')
                self.save()
                d = copy.deepcopy(self.project(pid)['datasets'][did])
            full = self.assay(pid, did)
            lookup = {s['id']: i for i,s in enumerate(d['samples'])}
            matrix = full[:, [lookup[s['id']] for s in samples]]
            work = self.folder(pid)/'runs'/jid
            logged, result, environment = engine.run_r(self.root, work, matrix, [f['id'] for f in d['features']], samples, d['unit'], snapshot['spec'].get('blocking_fields', []), snapshot['kind']=='pca', self.cancels[jid], lambda process: self.processes.__setitem__(jid, process))
            np.savez_compressed(work/'expression.npz', matrix=logged)
            manifest = dict(snapshot, job_id=jid, completed=now(), environment=environment, feature_ids=[f['id'] for f in d['features']], method='limma-voom · TMM' if d['unit'] in {'raw_count','estimated_count'} else 'limma-trend', direction='B vs A', tested_features=len(result) if result is not None else 0)
            if snapshot['kind']=='pca':
                keep = np.ones(len(logged), dtype=bool)
                if d['unit'] in {'raw_count','estimated_count'}:
                    cpm = matrix/np.maximum(matrix.sum(axis=0),1)*1e6
                    keep = (cpm>=1).sum(axis=1)>=2
                pca = engine.pca(logged[keep], samples, 'log2', snapshot['n_top'])
                original_indices = np.flatnonzero(keep)
                pca['feature_indices'] = original_indices[pca['feature_indices']].tolist()
                pca.update(sample_ids=[s['id'] for s in samples], samples=samples, run_id=jid, rule='CPM ≥ 1 in at least two samples; complete, nonzero-variance rows; most variable genes' if d['unit'] in {'raw_count','estimated_count'} else 'Complete, nonzero-variance rows; most variable genes', n_top=snapshot['n_top'])
                atomic_json(work/'pca.json', pca)
            atomic_json(work/'manifest.json', manifest)
            with self.lock:
                if self.cancels[jid].is_set():
                    raise Problem('job_cancelled','Analysis cancelled before publishing results.')
                p = self.project(pid)
                comp = p['comparisons'].get(snapshot['comparison_id'])
                matching = digest(comp['spec'])==digest(snapshot['spec']) if comp else p['datasets'][did].get('included',[s['id'] for s in d['samples']])==snapshot['spec']['included']
                if matching:
                    if comp:
                        if snapshot['kind']=='pca':
                            comp['pca_run_id'] = jid
                            comp['pca_spec_hash'] = digest(snapshot['spec'])
                        else:
                            comp.update(run_id=jid, result_spec_hash=digest(snapshot['spec']), result_selection=[s['id'] for s in samples], method=manifest['method'])
                    else:
                        p['datasets'][did]['pca_run_id'] = jid
                        p['datasets'][did]['pca_selection']=snapshot['spec']['included']
                job.update(status='completed', phase='Ready' if matching else 'Saved historical result; selection changed', completed=now(), applied=matching, run_path=str(work), method=manifest['method'])
                p['data_revision'] += 1
                self.mutate()
                self.save()
                self.finish_intake(p)
        except Exception as exc:
            problem = exc if isinstance(exc, Problem) else Problem('calculation_error', str(exc))
            with self.lock:
                self.state['jobs'][jid].update(status='cancelled' if problem.code=='job_cancelled' else 'failed', error=problem.record(), completed=now())
                self.mutate()
                self.save()
                self.finish_intake(self.project(snapshot['project_id']))
        finally:
            self.processes.pop(jid, None)

    def control_job(self, job_id, action='cancel', **_):
        with self.lock:
            if job_id not in self.state['jobs']:
                raise Problem('job_missing','Unknown job ID.')
            if action=='cancel' and self.state['jobs'][job_id]['status'] in {'queued','running'}:
                self.cancels[job_id].set()
                return {'job_id':job_id,'cancellation_requested':True}
            return copy.deepcopy(self.state['jobs'][job_id])

    def get_job(self, job_id, **_):
        if job_id not in self.state['jobs']:
            raise Problem('job_missing','Unknown job ID.')
        return copy.deepcopy(self.state['jobs'][job_id])

    def get_evidence(self, dataset_id, sample_id=None, **_):
        d = self.project()['datasets'].get(dataset_id)
        if not d:
            raise Problem('dataset_missing','Unknown dataset.')
        return {'source':d['source'],'source_sha256':d['source_sha256'],'recipe':d['recipe'],'annotation':d.get('annotation'),'classification':classification(d.get('data_type',d['unit']),has_average=d.get('capabilities',{}).get('ma',True)),'source_manifest':read_json(self.folder()/'sources/source_manifest.json'),'samples':[s for s in d['samples'] if not sample_id or s['id']==sample_id]}

    def inspect_dataset(self, dataset_id, feature_ids=None, offset=0, limit=20, **_):
        d=self.project()['datasets'].get(dataset_id)
        if not d:
            raise Problem('dataset_missing','Unknown dataset.')
        limit=max(1,min(100,int(limit)))
        features=d['features'][max(0,offset):max(0,offset)+limit]
        if feature_ids:
            requested=set(feature_ids[:100])
            features=[f for f in d['features'] if f['id'] in requested or f['display_name'] in requested][:100]
            matrix=None if d.get('result_only') else self.assay(self.project()['id'],dataset_id)
            indices={f['id']:i for i,f in enumerate(d['features'])}
            features=[dict(f,values=matrix[indices[f['id']]].tolist() if matrix is not None else None) for f in features]
        return {'dataset_id':dataset_id,'unit':d['unit'],'features':features,'samples':d['samples'],'total_features':d['rows']}

    def payload(self):
        with self.lock:
            if not self.state['active_project']:
                return {'genes':default_panel('Homo sapiens'),'datasets':[],'log_offset':0.1,'view':{},'revision':self.state['revision'],'project':None}
            p = self.project()
            payload = {'genes':p['panel'].copy(),'datasets':[],'log_offset':0.1,'view':copy.deepcopy(p['view']),'revision':self.state['revision'],'project':{'id':p['id'],'name':p['name'],'panel_name':p['panel_name'],'organism':p['organism']},'data_revision':p['data_revision']}
            panel = p['panel']
            for comp in p['comparisons'].values():
                d = p['datasets'][comp['dataset_id']]
                if p.get('intake') and d['id'] not in p.get('published_dataset_ids', []):
                    continue
                if d.get('result_only'):
                    payload['datasets'].append(self.results_payload(p, d, comp))
                    entry = next((e for e in p.get('intake', {}).values() if e['status'] != 'excluded' and d['id'] in e.get('dataset_ids', [])), None)
                    if entry and entry.get('display_label'):
                        payload['datasets'][-1]['gse_label'] = entry['display_label']
                    continue
                full = self.assay(p['id'],d['id'])
                si = [i for i,s in enumerate(d['samples']) if s['id'] in comp['samples']]
                samples = [dict(d['samples'][i], group=comp['spec']['groups'].get(d['samples'][i]['id'],'N/A'), column=d['samples'][i]['source_column']) for i in si]
                raw = full[:,si]
                # The preview layer uses all cohort samples. A completed run supplies its model-fitted effects.
                logged = raw if d['unit']=='log2' else np.log2(raw/raw.sum(axis=0)*1e6+0.1) if d['unit'] in {'raw_count','estimated_count'} else np.log2(raw+0.1)
                effect, ave = np.full(len(raw),np.nan), logged.mean(axis=1)
                a = [i for i,s in enumerate(samples) if s['group']=='Group A']
                b = [i for i,s in enumerate(samples) if s['group']=='Group B']
                if a and b:
                    effect = logged[:,b].mean(axis=1)-logged[:,a].mean(axis=1)
                rp, ap = np.full(len(raw),np.nan),np.full(len(raw),np.nan)
                current = bool(comp.get('run_id') and comp.get('result_spec_hash')==digest(comp['spec']))
                not_tested = {}
                if current:
                    work = self.folder()/ 'runs'/comp['run_id']
                    results = pd.read_csv(work/'results.tsv',sep='\t',dtype={'feature_id':str}).set_index('feature_id')
                    if (work/'testing.tsv').is_file():
                        testing = pd.read_csv(work/'testing.tsv', sep='\t', dtype=str, keep_default_na=False)
                        not_tested = dict(zip(testing['feature_id'], testing['reason']))
                    elif comp.get('method') in {'limma-voom · TMM', 'limma-trend'}:
                        # Older runs used the same filters but did not save per-feature reasons.
                        not_tested = {f['id']: 'low_expression' if d['unit'] in {'raw_count', 'estimated_count'} else 'non_variable'
                                      for f in d['features'] if f['id'] not in results.index}
                    indexed = results.reindex([f['id'] for f in d['features']])
                    for name,array in [('logFC',effect),('AveExpr',ave),('P.Value',rp),('adj.P.Val',ap)]:
                        array[:] = pd.to_numeric(indexed[name],errors='coerce').to_numpy(float)
                    with np.load(work/'expression.npz',allow_pickle=False) as z:
                        runlog = z['matrix']
                    for j,sample in enumerate(samples):
                        if sample['id'] in comp['result_selection']:
                            logged[:,j] = runlog[:,comp['result_selection'].index(sample['id'])]
                points = [[f['display_name'],ave[i],effect[i],rp[i],ap[i]] for i,f in enumerate(d['features']) if np.isfinite(ave[i]) and np.isfinite(effect[i])]
                point_indices = [i for i in range(len(raw)) if np.isfinite(ave[i]) and np.isfinite(effect[i])]
                feature_lookup = {f['display_name'].lower():i for i,f in enumerate(d['features'])}
                vals,codes,effects,sigs,aves = [],[],[],[],[]
                for gene in panel:
                    i = feature_lookup.get(gene.lower())
                    vals.append(logged[i].tolist() if i is not None else [None]*len(samples))
                    codes.append(d['features'][i]['id'] if i is not None else None)
                    effects.append(effect[i] if i is not None else None)
                    aves.append(ave[i] if i is not None else None)
                    sigs.append({'p_value':rp[i] if i is not None and current else None,'adj_p':ap[i] if i is not None and current else None,'status':'missing' if i is None else 'pass' if current and np.isfinite(ap[i]) and ap[i]<=.05 else 'not_significant' if current and np.isfinite(ap[i]) else 'unavailable'})
                    if i is not None and current and not_tested.get(d['features'][i]['id']):
                        sigs[-1]['reason'] = not_tested[d['features'][i]['id']]
                    elif i is not None and not current:
                        sigs[-1]['reason'] = 'pending_calculation'
                def pack(v):
                    return base64.b64encode(gzip.compress(encoded(v),mtime=0)).decode('ascii')
                pca_run = comp.get('pca_run_id') if comp.get('pca_spec_hash')==digest(comp['spec']) else None
                pca = read_json(self.folder()/'runs'/pca_run/'pca.json') if pca_run else None
                payload['datasets'].append(clean({'dataset_id':comp['id'],'source_dataset_id':d['id'],'label':comp['label'],'gse':d['gse'],'organism':d['organism'],'unit':'log2 expression','prelogged':True,'count_library_sizes':None,'samples':samples,'values':vals,'codes':codes,'original_effects':effects,'significance':sigs,'ma_points_gzip':pack(points),'ma_matrix_gzip':pack(logged[point_indices]),'statistics_current':current,'method':comp.get('method'),'included':comp['included'],'pca':pca,'a_label':comp['a_label'],'b_label':comp['b_label']}))
                payload['datasets'][-1]['original_aves']=clean(aves)
                intake_entry = next((e for e in p.get('intake', {}).values() if e['status'] != 'excluded' and d['id'] in e.get('dataset_ids', [])), None)
                if intake_entry and intake_entry.get('display_label'):
                    payload['datasets'][-1]['gse_label'] = intake_entry['display_label']
                payload['datasets'][-1].update(classification(d['unit']))
            # Datasets without a contrast can still be inspected and have an independent sample PCA.
            used = {c['dataset_id'] for c in p['comparisons'].values()}
            for did,d in p['datasets'].items():
                if did in used:
                    continue
                if d.get('result_only') or (p.get('intake') and did not in p.get('published_dataset_ids', [])):
                    continue
                samples=[dict(s,column=s['source_column'],group=s.get('group','N/A')) for s in d['samples']]
                pca=read_json(self.folder()/'runs'/d['pca_run_id']/'pca.json') if d.get('pca_run_id') and d.get('pca_selection')==d.get('included',[s['id'] for s in samples]) else None
                payload['datasets'].append({'dataset_id':did,'source_dataset_id':did,'label':d['label']+' · no contrast','gse':d['gse'],'organism':d['organism'],'unit':d['unit'],'prelogged':d['unit']=='log2','samples':samples,'values':[[None]*len(samples) for _ in panel],'codes':[None]*len(panel),'original_effects':[None]*len(panel),'significance':[{'status':'missing','p_value':None,'adj_p':None} for _ in panel],'ma_points_gzip':base64.b64encode(gzip.compress(b'[]',mtime=0)).decode(),'ma_matrix_gzip':base64.b64encode(gzip.compress(b'[]',mtime=0)).decode(),'statistics_current':False,'included':[s['id'] for s in samples],'pca':pca,'no_contrast':True})
            for item in payload['datasets']:
                entry=next((e for e in p.get('intake',{}).values()
                            if e.get('status') != 'excluded' and item.get('source_dataset_id') in e.get('dataset_ids',[])),None)
                if entry is None:
                    entry=next((e for e in p.get('intake',{}).values()
                                if e.get('status') != 'excluded' and e.get('gse')==item.get('gse')),None)
                if entry and entry.get('display_label'):
                    item['gse_label']=entry['display_label']
                item['study_title']=' '.join(entry.get('report',{}).get('title',[])) if entry else ''
                metadata={s.get('gsm'):s for s in (entry or {}).get('samples',[])}
                for sample in item.get('samples',[]):
                    source_sample=metadata.get(sample.get('gsm') or sample.get('id'),{})
                    sample['condition_fields']=[v for v in source_sample.get('characteristics',[]) if re.match(r'^(?:treatment|drug|compound|time|duration|dose|genotype|diet|sex|age|cell line|tissue)',v,re.I)]
                if item.get('no_contrast'):
                    item['original_aves']=[None]*len(panel)
                    source=p['datasets'][item['source_dataset_id']]
                    item['included']=source.get('included',[s['id'] for s in source['samples']])
            return clean(payload)

    def export_project(self, kind='results', comparison_id=None, filename=None, **_):
        with self.lock:
            p = self.project()
            exports = self.folder()/'exports'
            exports.mkdir(exist_ok=True)
            base = re.sub(r'[<>:"/\\|?*]', '_', filename or p['name'])
            if kind in {'panel','template'}:
                path=exports/(base+'_gene_panel.xlsx')
                panel = default_panel(p['organism'] or 'Homo sapiens') if kind=='template' else p['panel']
                pd.DataFrame({'No.':range(1,len(panel)+1),'Gene symbol':panel}).to_excel(path,sheet_name='Gene panel',index=False)
            elif kind=='bundle':
                path=exports/(base+'.nozeomics.zip')
                with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr('project.json',encoded(p))
                    for item in self.folder().rglob('*'):
                        if item.is_file() and 'exports' not in item.relative_to(self.folder()).parts and 'staging' not in item.relative_to(self.folder()).parts:
                            archive.write(item,str(item.relative_to(self.folder())))
            elif kind=='summary':
                path=exports/(base+'_dataset_summary.xlsx')
                rows=[]
                for c in p['comparisons'].values():
                    d=p['datasets'][c['dataset_id']]
                    counts={g:sum(s in c['included'] and v==g for s,v in c['spec']['groups'].items()) for g in ['Group A','Group B']}
                    info=d.get('study_info',{});current=bool(c.get('run_id') and c.get('result_spec_hash')==digest(c['spec']))
                    rows.append({'GSE':d['gse'],'Drug':info.get('drug',c['b_label']),'Drug description':info.get('drug_description',''),'n (A vs B)':'Not supplied (result table)' if d.get('result_only') else f"{counts['Group A']} vs {counts['Group B']}",'Suitability':info.get('suitability','Supported' if current else 'Analysis pending'),'Note':info.get('note',''),'Tissue':d['tissue'],'Comparison':c['a_label']+' vs '+c['b_label'],'Method':c.get('method'),'Statistics current':current,'Data type':d.get('data_type_label',classification(d['unit'])['data_type_label'])})
                pd.DataFrame(rows).to_excel(path,index=False,sheet_name='Dataset summary')
            else:
                comp=p['comparisons'].get(comparison_id)
                if not comp or not comp.get('run_id') or comp.get('result_spec_hash')!=digest(comp['spec']):
                    raise Problem('current_results_required','Run the selected comparison before exporting its current statistics.')
                d=p['datasets'][comp['dataset_id']]
                if d.get('result_only'):
                    result=pd.read_csv(self.folder()/'datasets'/d['id']/'submitted-results.tsv',sep='\t',dtype={'feature_id':str})
                    result.insert(1,'Gene symbol',[f['symbol'] for f in d['features']])
                    path=exports/(base+'.xlsx')
                    with pd.ExcelWriter(path) as writer:
                        result.to_excel(writer,index=False,sheet_name='Submitted results')
                        pd.DataFrame([{'field':k,'value':str(v)} for k,v in d['recipe'].items()]).to_excel(writer,index=False,sheet_name='Source definition')
                    return {'path':str(path),'bytes':path.stat().st_size,'kind':kind,'revision':self.state['revision']}
                folder=self.folder()/'runs'/comp['run_id']
                result=pd.read_csv(folder/'results.tsv',sep='\t',dtype={'feature_id':str})
                matrix=self.assay(p['id'],d['id'])
                ids=[s['id'] for s in d['samples']]
                values=pd.DataFrame(matrix,columns=ids)
                values.insert(0,'name',[f['symbol'] or f['id'] for f in d['features']])
                values.insert(0,'code',[f['id'] for f in d['features']])
                merged=values.merge(result,left_on='code',right_on='feature_id',how='left',validate='one_to_one')
                path=exports/(base+'.xlsx')
                with pd.ExcelWriter(path,engine='openpyxl') as writer:
                    merged.to_excel(writer,index=False,sheet_name='Expression and results')
                    selected=[s for s in d['samples'] if s['id'] in comp['result_selection']]
                    with np.load(folder/'expression.npz',allow_pickle=False) as z:
                        expression=z['matrix']
                    standardized=pd.DataFrame(expression,columns=[s['id'] for s in selected])
                    standardized.insert(0,'name',[f['symbol'] or f['id'] for f in d['features']])
                    standardized.insert(0,'code',[f['id'] for f in d['features']])
                    standardized=standardized.merge(result,left_on='code',right_on='feature_id',how='left',validate='one_to_one')
                    standardized.to_excel(writer,index=False,sheet_name='Standardized')
                    pd.DataFrame([{'GSM accession':s.get('gsm') or s['id'],'Sample name':s.get('name') or s['id'],'Group':comp['spec']['groups'][s['id']],'Matrix column':s['id'],**{k:v for k,v in s.items() if k not in {'evidence','group'}}} for s in selected]).to_excel(writer,index=False,sheet_name='Sample_metadata')
                    pd.DataFrame({'No.':range(1,len(p['panel'])+1),'Gene symbol':p['panel']}).to_excel(writer,index=False,sheet_name='Gene panel')
                    report=read_json(folder/'manifest.json')
                    report.update(input_data='Log-normalized',output_data_type='log2 expression',organism=d['organism'],gse_accession=d['gse'],legacy_note='Standardized contains the saved normalized log expression; original assay is in Expression and results.')
                    pd.DataFrame([{'field':k,'value':json.dumps(clean(v),ensure_ascii=False) if isinstance(v,(dict,list)) else str(v)} for k,v in report.items()]).to_excel(writer,index=False,sheet_name='Report')
                    evidence=[dict(sample=s['id'],**e) for s in d['samples'] for e in s.get('evidence',[])]
                    pd.DataFrame(evidence).to_excel(writer,index=False,sheet_name='Mapping evidence')
            return {'path':str(path),'bytes':path.stat().st_size,'kind':kind,'revision':self.state['revision']}

    def import_panel(self, path, base_revision=None, **_):
        frame = imports.table(path)
        column = next((c for c in frame.columns if c.lower() in {'gene symbol','gene','name','symbol'}), frame.columns[-1])
        panel = list(dict.fromkeys(str(v).strip() for v in frame[column] if str(v).strip() and str(v).strip().lower()!='nan'))
        return self.update_view(panel=panel,panel_name=Path(path).stem,base_revision=base_revision)

    def restore_project(self, path, base_revision=None, **_):
        with self.lock:
            if base_revision is not None and base_revision!=self.state['revision']:
                raise Problem('revision_conflict','Read the current state before opening this bundle.')
            with zipfile.ZipFile(path) as archive:
                p=json.loads(archive.read('project.json'))
                if p.get('id') in self.state['projects']:
                    p['id']=str(uuid.uuid4())
                    p['name']+=' (restored)'
                dest=self.home/'projects'/p['id']
                for member in archive.infolist():
                    target=(dest/member.filename).resolve()
                    if not target.is_relative_to(dest.resolve()):
                        raise Problem('invalid_bundle','The project bundle contains an invalid path.')
                    if member.file_size>4*1024**3:
                        raise Problem('invalid_bundle','A bundle member exceeds the supported size.')
                dest.mkdir(parents=True,exist_ok=True)
                archive.extractall(dest)
            for d in p['datasets'].values():
                d['source']=str(dest/'datasets'/d['id']/Path(d['source']).name)
            self.mutate(base_revision)
            self.state['projects'][p['id']]=p
            self.state['active_project']=p['id']
            self.save()
            return self.snapshot()

    def viewer_receipt(self, revision, plot, **_):
        with self.lock:
            self.state['receipts'].append({'revision':revision,'plot':plot,'rendered_at':now()})
            self.state['receipts']=self.state['receipts'][-20:]
            self.save()
        return {'recorded':True}
