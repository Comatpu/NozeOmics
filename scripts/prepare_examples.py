"""Recorded adapters for the two acceptance datasets; not ingestion heuristics."""
import sys,json,re,time,shutil,gzip
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from backend.projects import Workspace
from backend.imports import download,table
home=root/'.local/verified-examples';w=Workspace(root,home)
fixtures=root/'fixtures'
def characteristics(sample):
    return dict(v.split(': ',1) for v in sample['fields'].get('Sample_characteristics_ch1',[]) if ': ' in v)
def wait(jobs):
    while any(w.get_job(j)['status'] in {'queued','running'} for j in jobs):time.sleep(.3)
    for j in jobs:
        status=w.get_job(j);print(status['kind'],status['status'],status.get('error',''),flush=True)
        if status['status']!='completed':raise RuntimeError(status)
def create255():
    w.open_project(name='GSE255988 · paired ethanol response')
    meta=json.loads((fixtures/'GSE255988.json').read_text(encoding='utf-8'));path=fixtures/'GSE255988_MgPRS_raw_counts.tsv.gz'
    frame=table(path,{'row_names':True});assert frame.iloc[0,0]=='ENSG00000087086';assert float(frame.iloc[0,1])==261971
    samples=[];groups={}
    for s in meta['samples']:
        chars=characteristics(s);title=s['fields']['Sample_title'][0];short=re.search(r'cell line (\d+)',title)[1];treated=chars['treatment'].lower()!='control';column=f'MgEtOH{short}_{75 if treated else 0}'
        assert column in frame.columns
        sample={'id':s['gsm'],'gsm':s['gsm'],'source_column':column,'name':title,'subject':chars['cell line'],'PRS':chars['genotype'],'tissue':'Microglia','group':'Group B' if treated else 'Group A','biological_replicate':True,'evidence':[{'source':'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc='+s['gsm'],'locator':'Sample_title + characteristics + source matrix header','value':title+' | '+chars['treatment']+' | '+column}]}
        samples.append(sample);groups[s['gsm']]=sample['group']
    answer=w.import_dataset(path=str(path),organism='Homo sapiens',gse='GSE255988',tissue='Microglia',recipe={'row_names':True,'gene_column':'__feature_id__','unit':'raw_count','identifiers':'ensembl'},samples=samples,adapter_path=__file__)
    cid=w.configure_comparison(dataset_id=answer['dataset']['id'],groups=groups,label='GSE255988 · ethanol vs control',a_label='Control',b_label='Ethanol 75 mM',blocking_fields=['subject'])['comparison']['id']
    jobs=[w.start_analysis(comparison_id=cid,kind=k)['job']['id'] for k in ['differential','pca']];wait(jobs)
    w.update_view(view={'graphType':'ma','maDatasetId':cid},panel=['ACTB','GAPDH','RPLP0','B2M','PTPRC','AIF1','CX3CR1','P2RY12','TREM2','APOE','IL1B','TNF','CCL2','SLC2A1'])
    return w.project()['id']
def create304():
    meta=json.loads((fixtures/'GSE304862.json').read_text(encoding='utf-8'));dest=fixtures/'GSE304862';dest.mkdir(exist_ok=True)
    def get(s):
        f=s['fields'];url=f['Sample_supplementary_file_1'][0].replace('ftp://','https://');lib=f['Sample_description'][0].split('Library name: ',1)[1].strip();assert lib in url and s['gsm'] in url
        path=dest/url.split('/')[-1]
        if not path.exists():
            for attempt in range(3):
                try:download(url,path);break
                except Exception:
                    if attempt==2:raise
        frame=pd.read_csv(path,sep='\t',header=None,dtype=str,keep_default_na=False)
        # HTSeq files contain two columns, no header and five __* bookkeeping rows.
        assert frame.shape[1]==2
        valid=~frame[0].str.startswith('__');frame=frame[valid]
        values=pd.to_numeric(frame[1],errors='raise');assert (values>=0).all();assert frame[0].is_unique
        return s,lib,pd.Series(values.to_numpy(),index=frame[0].tolist(),name=lib),url
    with ThreadPoolExecutor(8) as pool:records=list(pool.map(get,meta['samples']))
    print('GSE304862',len(records),'source libraries retrieved and matched',flush=True)
    w.open_project(name='GSE304862 · tissue-specific semaglutide response')
    cohort={}
    for record in records:
        s=record[0];tissue=characteristics(s)['tissue']
        # Aorta preparation notes are retained in the sample evidence.
        if tissue.startswith('aorta'):
            assert s['fields']['Sample_title'][0].startswith('A.')
            tissue='aorta'
        cohort.setdefault(tissue,[]).append(record)
    jobs=[]
    for tissue,rows in cohort.items():
        matrices=[r[2] for r in rows];ids=matrices[0].index
        assert all(v.index.equals(ids) for v in matrices)
        frame=pd.concat(matrices,axis=1);frame.index.name='feature_id';path=dest/(re.sub('[^A-Za-z]+','_',tissue)+'.tsv.gz');frame.to_csv(path,sep='\t')
        samples=[];groups={}
        for s,lib,values,url in rows:
            ch=characteristics(s);treatment=ch['treatment'];group={'HH':'Group A','HHS':'Group B'}.get(treatment,'N/A');groups[s['gsm']]=group
            samples.append({'id':s['gsm'],'gsm':s['gsm'],'source_column':lib,'name':s['fields']['Sample_title'][0],'tissue':tissue,'subject':ch['animalnr'],'treatment':treatment,'group':group,'biological_replicate':True,'evidence':[{'source':'https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc='+s['gsm'],'locator':'Sample_description + supplementary filename','value':'Library name: '+lib+' | '+url},{'source':url,'locator':'HTSeq gene counts; __* bookkeeping rows excluded in recorded adapter','value':lib}]})
        answer=w.import_dataset(path=str(path),organism='Mus musculus',gse='GSE304862',tissue=tissue,recipe={'gene_column':'feature_id','unit':'raw_count','identifiers':'ensembl'},samples=samples,adapter_path=__file__,label='GSE304862 · '+tissue)
        cid=w.configure_comparison(dataset_id=answer['dataset']['id'],groups=groups,label='GSE304862 · '+tissue,a_label='HFD vehicle (HH)',b_label='HFD semaglutide (HHS)')['comparison']['id']
        jobs.extend(w.start_analysis(comparison_id=cid,kind=k)['job']['id'] for k in ['differential','pca'])
    wait(jobs);w.update_view(view={'graphType':'pca'})
    return w.project()['id']
if __name__=='__main__':
    ids=[]
    existing={p['name']:p['id'] for p in w.state['projects'].values()}
    for name,func in [('GSE255988 · paired ethanol response',create255),('GSE304862 · tissue-specific semaglutide response',create304)]:
        if name in existing and all(c.get('run_id') and c.get('pca_run_id') for c in w.project(existing[name])['comparisons'].values()):ids.append(existing[name]);print('Existing project',name,flush=True)
        else:ids.append(func())
    for pid in ids:
        w.open_project(project_id=pid);bundle=w.export_project(kind='bundle');shutil.copy2(bundle['path'],fixtures/Path(bundle['path']).name);print(bundle['path'],flush=True)
    w.open_project(project_id=ids[0]);w.pool.shutdown(wait=True)
