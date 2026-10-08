"""Submitted DE results retain their provenance and cannot masquerade as an assay."""
import base64
import copy
import gzip
import shutil
import uuid
from pathlib import Path
import numpy as np
import pandas as pd
from . import imports
from .common import Problem, atomic_json, clean, default_panel, digest, encoded, file_hash, now, species_name
from .data_types import classification


class ResultTables:
    def import_results(self, path, organism, gse, recipe, label=None, a_label='Control', b_label='Treated', tissue=None, base_revision=None, **_):
        with self.lock:
            p = self.project()
            species = species_name(organism)
            if p['organism'] and p['organism'] != species:
                raise Problem('mixed_species', 'Use a separate project for human and mouse datasets.')
            ids, symbols, results, annotation = imports.extract_results(path, recipe, species, self.home/'annotation')
            self.mutate(base_revision)
            did, cid = str(uuid.uuid4()), str(uuid.uuid4())
            dest = self.folder()/'datasets'/did
            dest.mkdir(parents=True)
            original = Path(path).resolve()
            source = dest/('source-'+original.name)
            shutil.copy2(original, source)
            results.to_csv(dest/'submitted-results.tsv', sep='\t', index=False)
            counts = pd.Series(symbols).value_counts().to_dict()
            features = [{'id': gid, 'symbol': sym, 'display_name': sym if sym and counts.get(sym) == 1 else f'{sym} [{gid}]' if sym else gid} for gid, sym in zip(ids, symbols)]
            d = {'id': did, 'gse': gse.upper(), 'label': label or gse, 'organism': species, 'tissue': tissue or '',
                 'unit': 'submitted_log2FC', 'result_only': True, 'features': features, 'samples': [],
                 'rows': len(ids), 'columns': 0, 'source': str(source), 'source_sha256': file_hash(source),
                 'recipe': copy.deepcopy(recipe), 'annotation': annotation, 'imported': now()}
            d.update(classification(recipe['data_type'], has_average=bool((np.isfinite(results['AveExpr']) & np.isfinite(results['logFC'])).any())))
            atomic_json(dest/'manifest.json', d)
            p['datasets'][did] = d
            spec = {'dataset_id': did, 'groups': {}, 'blocking_fields': [], 'included': []}
            p['comparisons'][cid] = {'id': cid, 'dataset_id': did, 'label': label or gse, 'a_label': a_label,
                                    'b_label': b_label, 'samples': [], 'included': [], 'spec': spec,
                                    'run_id': 'submitted', 'result_spec_hash': digest(spec),
                                    'result_selection': [], 'method': 'Submitted DE results'}
            if not p['organism']:
                p.update(organism=species)
                if p['panel_name'].endswith('_default_panel'):
                    p.update(panel=default_panel(species), panel_name=('Human' if species == 'Homo sapiens' else 'Mouse')+'_default_panel')
            p['data_revision'] += 1
            self.save()
            return {'dataset_id': did, 'comparison_id': cid, **classification(recipe['data_type'], has_average=d['capabilities']['ma']), 'revision': self.state['revision']}

    def results_payload(self, p, d, comp):
        result = pd.read_csv(self.folder()/'datasets'/d['id']/'submitted-results.tsv', sep='\t', dtype={'feature_id': str})
        lookup = {f['display_name'].lower(): i for i, f in enumerate(d['features'])}
        rows = {key: pd.to_numeric(result[key], errors='coerce').to_numpy(float) for key in ['AveExpr', 'logFC', 'P.Value', 'adj.P.Val']}
        points = [[f['display_name'], rows['AveExpr'][i], rows['logFC'][i], rows['P.Value'][i], rows['adj.P.Val'][i]] for i, f in enumerate(d['features']) if np.isfinite(rows['logFC'][i]) and np.isfinite(rows['AveExpr'][i])]
        indices = [lookup.get(g.lower()) for g in p['panel']]
        def vals(key):
            return [rows[key][i] if i is not None else None for i in indices]
        return clean({'dataset_id': comp['id'], 'source_dataset_id': d['id'], 'label': comp['label'], 'gse': d['gse'],
                      'organism': d['organism'], 'unit': 'log2 expression', 'prelogged': True, 'result_only': True,
                      'samples': [], 'included': [], 'values': [[] for _ in p['panel']],
                      'codes': [d['features'][i]['id'] if i is not None else None for i in indices],
                      'original_effects': vals('logFC'), 'original_aves': vals('AveExpr'),
                      'significance': [{'p_value': rows['P.Value'][i] if i is not None else None,
                                        'adj_p': rows['adj.P.Val'][i] if i is not None else None,
                                        'status': 'missing' if i is None else 'pass' if np.isfinite(rows['adj.P.Val'][i]) and rows['adj.P.Val'][i] <= .05 else 'not_significant' if np.isfinite(rows['adj.P.Val'][i]) else 'unavailable'} for i in indices],
                      'ma_points_gzip': base64.b64encode(gzip.compress(encoded(points))).decode(),
                      'ma_matrix_gzip': base64.b64encode(gzip.compress(encoded([[] for _ in points]))).decode(),
                      'statistics_current': True, 'method': comp['method'], 'a_label': comp['a_label'], 'b_label': comp['b_label'], 'pca': None,
                      **classification(d['data_type'], has_average=d['capabilities']['ma'])})
