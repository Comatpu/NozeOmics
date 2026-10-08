import unittest,tempfile,time,threading,sys,json
from pathlib import Path
from unittest.mock import patch
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend.projects import Workspace
from backend import imports,engine
from backend.common import Problem,digest

class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'.local');self.home=Path(self.temp.name);self.w=Workspace(ROOT,self.home);self.w.open_project(name='Test')
    def tearDown(self):
        self.w.pool.shutdown(wait=True);self.temp.cleanup()
    def fixture(self,unit='raw_count',paired=True):
        rng=np.random.default_rng(27);counts=rng.negative_binomial(12,.1,(180,8))+8;counts[:12,4:]*=4;path=self.home/'input.tsv';pd.DataFrame(counts,columns=[f'S{i}' for i in range(8)]).assign(gene=[f'G{i}' for i in range(180)]).to_csv(path,sep='\t',index=False)
        samples=[{'id':f'S{i}','source_column':f'S{i}','subject':str(i%4),'tissue':'liver','group':'Group A' if i<4 else 'Group B','evidence':[{'source':str(path),'locator':f'header S{i}','value':f'S{i}'}]} for i in range(8)]
        did=self.w.import_dataset(path=path,organism='mouse',recipe={'unit':unit,'gene_column':'gene','identifiers':'symbol'},samples=samples)['dataset']['id']
        cid=self.w.configure_comparison(dataset_id=did,groups={s['id']:s['group'] for s in samples},blocking_fields=['subject'] if paired else [])['comparison']['id']
        return did,cid,counts,samples
    def wait(self,jid):
        deadline=time.time()+60
        while self.w.get_job(jid)['status'] in {'queued','running'} and time.time()<deadline:time.sleep(.1)
        return self.w.get_job(jid)
    def test_r_export_header_first_gene_is_retained(self):
        path=ROOT/'fixtures/GSE255988_MgPRS_raw_counts.tsv.gz';f=imports.table(path,{'row_names':True});self.assertEqual(f.shape[1],19);self.assertEqual(f.iloc[0,0],'ENSG00000087086');self.assertEqual(int(f.iloc[0,1]),261971);self.assertTrue(imports.inspect_file(path)['implicit_row_names'])
    def test_actual_cell4_compatibility(self):
        path=ROOT.parent/'outputs/melanoma-analysis/GSE274531_generalized_data.xlsx';a=self.w.import_dataset(path=path,legacy=True);self.assertEqual(a['dataset']['gse'],'GSE274531');p=self.w.payload();self.assertTrue(p['datasets'][0]['statistics_current']);self.assertEqual(len(p['datasets'][0]['samples']),4)
    def test_paired_model_reference_and_pca_panel_independence(self):
        did,cid,counts,samples=self.fixture();jid=self.w.start_analysis(comparison_id=cid)['job']['id'];self.assertEqual(self.wait(jid)['status'],'completed');actual=pd.read_csv(self.w.folder()/'runs'/jid/'results.tsv',sep='\t').set_index('feature_id');self.assertGreater(actual.loc[[f'G{i}' for i in range(12)],'logFC'].median(),1.0)
        # Independent R formula construction and fit, with the same submitted universe.
        reference=self.home/'reference';reference.mkdir();pd.DataFrame(counts,index=[f'G{i}' for i in range(180)],columns=[s['id'] for s in samples]).to_csv(reference/'matrix.tsv',sep='\t',index_label='gene')
        code="suppressPackageStartupMessages(library(edgeR));suppressPackageStartupMessages(library(limma));m<-as.matrix(read.delim('matrix.tsv',row.names=1,check.names=FALSE));d<-model.matrix(~factor(rep(0:3,2))+factor(rep(c('A','B'),each=4)));y<-calcNormFactors(DGEList(m));k<-filterByExpr(y,design=d);f<-eBayes(lmFit(voom(y[k,,keep.lib.sizes=TRUE],d,plot=FALSE),d));r<-topTable(f,coef=ncol(d),number=Inf,sort.by='none');write.table(r,'reference.tsv',sep='\\t',quote=FALSE,col.names=NA)"
        import subprocess,os
        env=os.environ.copy();env['LC_ALL']='C';subprocess.run([str(engine.rscript(ROOT)),'--vanilla','-e',code],cwd=reference,env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
        expected=pd.read_csv(reference/'reference.tsv',sep='\t',index_col=0);np.testing.assert_allclose(actual.loc[expected.index,['logFC','P.Value','adj.P.Val']],expected[['logFC','P.Value','adj.P.Val']],rtol=1e-10,atol=1e-12)
        pj=self.w.start_analysis(comparison_id=cid,kind='pca')['job']['id'];self.assertEqual(self.wait(pj)['status'],'completed');before=json.loads((self.w.folder()/'runs'/pj/'pca.json').read_text(encoding='utf-8'));self.w.update_view(panel=['G1','G2'],view={'cutoffIndex':0});after=self.w.payload()['datasets'][0]['pca'];self.assertEqual(before['points'],after['points'])
    def test_stale_result_not_applied(self):
        did,cid,counts,samples=self.fixture();started=threading.Event();release=threading.Event();original=engine.run_r
        def delayed(*a,**kw):started.set();release.wait(10);return original(*a,**kw)
        with patch.object(engine,'run_r',delayed):
            jid=self.w.start_analysis(comparison_id=cid)['job']['id'];self.assertTrue(started.wait(3));self.w.update_view(view={'selected_samples':{cid:['S1','S2','S3','S5','S6','S7']}});release.set();job=self.wait(jid)
        self.assertEqual(job['status'],'completed');self.assertFalse(job['applied']);self.assertIsNone(self.w.project()['comparisons'][cid]['run_id'])
    def test_revision_idempotence_and_bundle_roundtrip(self):
        did,cid,counts,samples=self.fixture();old=self.w.state['revision'];a=self.w.update_view(panel=['G2','G1'],base_revision=old,request_id='repeat');b=self.w.update_view(panel=['G2','G1'],base_revision=old,request_id='repeat');self.assertEqual(a,b)
        with self.assertRaises(Problem) as conflict:self.w.update_view(panel=['G1'],base_revision=old)
        self.assertEqual(conflict.exception.code,'revision_conflict')
        with self.assertRaises(Problem):self.w.update_view(panel=['G3'],request_id='repeat')
        bundle=self.w.export_project(kind='bundle')['path'];self.w.restore_project(bundle);self.assertEqual(self.w.project()['panel'],['G2','G1']);np.testing.assert_array_equal(self.w.assay(self.w.project()['id'],did),counts);self.assertTrue(Path(self.w.get_evidence(did)['source']).exists())
        self.w.save();reopened=Workspace(ROOT,self.home);self.assertEqual(reopened.project()['panel'],['G2','G1']);reopened.pool.shutdown(wait=True)
    def test_incomplete_pair_and_invalid_values_rejected(self):
        did,cid,counts,samples=self.fixture();self.w.update_view(view={'selected_samples':{cid:['S0','S1','S2','S3','S5','S6','S7']}});jid=self.w.start_analysis(comparison_id=cid)['job']['id'];job=self.wait(jid);self.assertEqual(job['status'],'failed');self.assertIn('incomplete subjects',job['error']['message'])
        f=self.home/'input.tsv';df=pd.read_csv(f,sep='\t').astype(object);df.loc[0,'S0']='missing';df.to_csv(f,sep='\t',index=False)
        with self.assertRaises(Problem) as caught:imports.extract(f,{'unit':'raw_count','gene_column':'gene','identifiers':'symbol'},samples,'mouse',self.home)
        self.assertEqual(caught.exception.code,'non_numeric_expression')
    def test_pca_without_differential_and_selection_invalidates(self):
        did,cid,counts,samples=self.fixture();self.w.project()['comparisons'].clear()
        jid=self.w.start_analysis(dataset_id=did,kind='pca')['job']['id'];self.assertEqual(self.wait(jid)['status'],'completed');self.assertEqual(len(self.w.payload()['datasets'][0]['pca']['points']),8)
        self.w.update_view(view={'dataset_selected_samples':{did:['S0','S1','S2','S4','S5','S6']}});self.assertIsNone(self.w.payload()['datasets'][0]['pca']);self.assertEqual(len(self.w.payload()['datasets'][0]['included']),6)
        jid=self.w.start_analysis(dataset_id=did,kind='pca')['job']['id'];self.assertEqual(self.wait(jid)['status'],'completed');self.assertEqual(len(self.w.payload()['datasets'][0]['pca']['points']),6)
    def test_export_current_stats_roundtrip(self):
        did,cid,counts,samples=self.fixture();jid=self.w.start_analysis(comparison_id=cid)['job']['id'];self.assertEqual(self.wait(jid)['status'],'completed');path=self.w.export_project(comparison_id=cid)['path'];old=imports.legacy(path);self.assertEqual(old['unit'],'log2');self.assertEqual(old['matrix'].shape,counts.shape);self.assertTrue(np.isfinite(old['matrix']).all())

if __name__=='__main__':unittest.main(verbosity=2)
