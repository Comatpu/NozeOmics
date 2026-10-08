import copy
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pandas as pd
from backend.projects import Workspace
from backend import imports
from backend.common import Problem

ROOT = Path(__file__).resolve().parents[1]


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'.local')
        self.w = Workspace(ROOT, self.temp.name)
        self.w.open_project(name='Batch', workflow='intake')

    def tearDown(self):
        self.w.pool.shutdown(wait=True)
        self.w.source_pool.shutdown(wait=True)
        self.temp.cleanup()

    def metadata(self, gse):
        return {'gse': gse, 'raw_text': 'test GEO metadata', 'series': {'Series_title': [gse], 'Series_supplementary_file': ['https://ftp.ncbi.nlm.nih.gov/test.tsv']},
                'samples': [{'gsm': 'GSM'+str(i), 'fields': {'Sample_title': ['sample '+str(i)], 'Sample_organism_ch1': ['Mus musculus']}, 'aliases': []} for i in range(4)]}

    def add(self, *gses):
        def download(url, dest, **_):
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_text('gene\tlogFC\tAveExpr\tp\tpadj\nActb\t1\t4\t0.001\t0.01\nGapdh\t-1\t3\t0.2\t0.5\n', encoding='utf-8')
            return {'path': str(dest), 'sha256': imports.file_hash(dest)}
        with patch.object(imports, 'geo_metadata', side_effect=self.metadata), patch.object(imports, 'download', side_effect=download) as fetch:
            ids = self.w.add_gses(accessions=list(gses))['entry_ids']
            deadline = time.time()+5
            while any(self.w.project()['intake'][i]['status']=='fetching' for i in ids) and time.time()<deadline:
                time.sleep(.02)
            fetch.assert_not_called()
            for eid in ids:
                entry = self.w.project()['intake'][eid]
                self.w.select_intake_files(entry_id=eid,file_ids=[entry['files'][0]['id']],note='Needed result table',project_id=self.w.project()['id'])
            deadline = time.time()+5
            while any(self.w.project()['intake'][i]['files'][0]['status']!='downloaded' for i in ids) and time.time()<deadline:
                time.sleep(.02)
        self.assertTrue(all(self.w.project()['intake'][i]['status']=='awaiting_review' for i in ids))
        return ids

    def test_large_inventory_downloads_only_selected_file_and_reuses_cache(self):
        metadata = self.metadata('GSE9')
        metadata['samples'] = metadata['samples'] * 50
        metadata['series']['Series_supplementary_file'] = ['https://ftp.ncbi.nlm.nih.gov/file'+str(i)+'.tsv' for i in range(200)]
        def download(url, dest, **_):
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_text('gene\tlogFC\tAveExpr\tp\tpadj\nActb\t1\t4\t0.001\t0.01\n', encoding='utf-8')
            return {'path': str(dest), 'sha256': imports.file_hash(dest)}
        with patch.object(imports, 'geo_metadata', return_value=metadata), patch.object(imports, 'download', side_effect=download) as fetch:
            eid, = self.w.add_gses(accessions=['GSE9'])['entry_ids']
            deadline=time.time()+5
            while self.w.project()['intake'][eid]['status']=='fetching' and time.time()<deadline:
                time.sleep(.02)
            entry=self.w.project()['intake'][eid]
            self.assertEqual(len(entry['samples']),200)
            self.assertEqual(len(entry['files']),200)
            fetch.assert_not_called()
            for _ in range(2):
                self.w.select_intake_files(entry_id=eid,file_ids=[entry['files'][0]['id']],note='Only this table is needed',project_id=self.w.project()['id'])
                deadline=time.time()+5
                while entry['files'][0]['status']!='downloaded' and time.time()<deadline:
                    time.sleep(.02)
            self.assertEqual(fetch.call_count,1)
            self.assertTrue(all(f['status']=='not_downloaded' for f in entry['files'][1:]))
            did=self.result(entry)
            self.review([self.decision(eid,did)])
            self.assertEqual(self.w.project()['stage'],'analysis')

    def result(self, entry, average=True):
        path = entry['files'][0]['path']
        recipe = {'data_type': 'de_result', 'gene_column': 'gene', 'effect_column': 'logFC', 'effect_scale': 'log2', 'direction': 'B_vs_A', 'identifiers': 'symbol', 'p_column': 'p', 'adjusted_p_column': 'padj'}
        if average:
            recipe.update(average_column='AveExpr', average_scale='log2')
        return self.w.import_results(path=path, organism='mouse', gse=entry['gse'], recipe=recipe)['dataset_id']

    def decision(self, eid, did=None, verdict='approve'):
        e = self.w.get_intake(entry_id=eid)['entries'][0]
        return {'entry_id': eid, 'review_fingerprint': e['review_fingerprint'], 'verdict': verdict, 'note': 'Checked source definition and original contrast.',
                'dataset_ids': [did] if did else [], 'contrast_evidence': 'Source describes treated vs control, log2 B/A.'}

    def review(self, decisions):
        return self.w.review_intake(decisions=decisions, project_id=self.w.project()['id'], base_revision=self.w.state['revision'])

    def test_partial_return_preserves_cache_then_all_pass(self):
        a,b = self.add('GSE1','GSE2')
        did = self.result(self.w.project()['intake'][a])
        self.review([self.decision(a,did),self.decision(b,verdict='return')])
        self.assertEqual(self.w.project()['stage'],'intake')
        self.assertEqual(self.w.project()['intake'][a]['status'],'approved')
        self.assertEqual(self.w.payload()['datasets'],[])
        second = self.result(self.w.project()['intake'][b])
        self.review([self.decision(b,second)])
        self.assertEqual(self.w.project()['stage'],'analysis')
        self.assertEqual(len(self.w.payload()['datasets']),2)
        self.assertFalse(self.w.payload()['datasets'][0]['capabilities']['pca'])
        self.w.pool.shutdown(wait=True)
        reopened = Workspace(ROOT,self.temp.name)
        self.assertEqual(reopened.project()['stage'],'analysis')
        self.assertEqual(len(reopened.payload()['datasets']),2)
        reopened.pool.shutdown(wait=True)
        reopened.source_pool.shutdown(wait=True)

    def test_groups_invalidate_only_changed_entry_and_stale_review_rejected(self):
        a,b = self.add('GSE1','GSE2')
        did = self.result(self.w.project()['intake'][a])
        decision = self.decision(a,did)
        self.review([decision])
        self.w.update_intake(entry_id=b,groups={'GSM0':'Group A'})
        self.assertEqual(self.w.project()['intake'][a]['status'],'approved')
        self.w.update_intake(entry_id=b,action='reorder',order=[b,a])
        self.assertEqual(self.w.project()['intake_order'],[b,a])
        self.assertEqual(self.w.project()['intake'][a]['status'],'approved')
        self.w.update_intake(entry_id=a,groups={'GSM0':'Group B'})
        self.assertEqual(self.w.project()['intake'][a]['status'],'awaiting_review')
        with self.assertRaises(Problem) as ctx:
            self.review([decision])
        self.assertEqual(ctx.exception.code,'review_stale')

    def test_no_average_results_support_trend_not_ma_and_direction_preserved(self):
        a, = self.add('GSE1')
        did = self.result(self.w.project()['intake'][a],average=False)
        self.review([self.decision(a,did)])
        d = self.w.payload()['datasets'][0]
        self.assertTrue(d['capabilities']['trend'])
        self.assertFalse(d['capabilities']['ma'])
        self.assertEqual(d['original_effects'][0],1)
        with self.assertRaises(Problem) as ctx:
            self.w.start_analysis(dataset_id=did,kind='pca')
        self.assertEqual(ctx.exception.code,'unsupported_analysis')
        exported=self.w.export_project(comparison_id=d['dataset_id'])
        with pd.ExcelFile(exported['path']) as workbook:
            self.assertIn('Submitted results',workbook.sheet_names)

    def test_matrix_review_uses_user_mapping_and_completes_analysis(self):
        a, = self.add('GSE1')
        self.w.update_intake(entry_id=a,groups={'GSM0':'Group A','GSM1':'Group A','GSM2':'Group B','GSM3':'Group B'})
        path=Path(self.temp.name)/'counts.tsv'
        rng=np.random.default_rng(35)
        pd.DataFrame(rng.integers(10,800,(120,4)),columns=['c0','c1','c2','c3']).assign(gene=['g'+str(i) for i in range(120)]).to_csv(path,sep='\t',index=False)
        samples=[{'id':'GSM'+str(i),'gsm':'GSM'+str(i),'source_column':'c'+str(i),'tissue':'kidney','evidence':[{'source':'GEO','locator':'sample '+str(i),'value':'GSM'+str(i)}]} for i in range(4)]
        did=self.w.import_dataset(path=path,organism='mouse',gse='GSE1',recipe={'unit':'raw_count','gene_column':'gene','identifiers':'symbol'},samples=samples)['dataset']['id']
        cid=self.w.configure_comparison(dataset_id=did,groups=self.w.project()['intake'][a]['groups'])['comparison']['id']
        with self.assertRaises(Problem) as ctx:
            self.w.start_analysis(comparison_id=cid)
        self.assertEqual(ctx.exception.code,'ai_review_required')
        self.review([self.decision(a,did)])
        deadline=time.time()+40
        while self.w.project()['stage']=='processing' and time.time()<deadline:
            time.sleep(.1)
        self.assertEqual(self.w.project()['stage'],'analysis',self.w.snapshot()['jobs'])
        self.assertTrue(self.w.payload()['datasets'][0]['statistics_current'])

if __name__=='__main__':
    unittest.main(verbosity=2)
