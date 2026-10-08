import sys,json,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from backend.projects import Workspace
from backend.common import file_hash,atomic_json
from backend.imports import now
for homedir in ['verified-examples','user-workspace']:
    w=Workspace(root,root/'.local'/homedir)
    for p in w.state['projects'].values():
        if not all(c.get('run_id') and c.get('pca_run_id') for c in p['comparisons'].values()):continue
        for gse in ['GSE255988','GSE304862']:
            if not any(d['gse']==gse for d in p['datasets'].values()):continue
            sources=w.folder(p['id'])/'sources';sources.mkdir(exist_ok=True)
            for suffix in ['soft','json']:shutil.copy2(root/'fixtures'/f'{gse}.{suffix}',sources/f'{gse}.{suffix}')
            meta=json.loads((root/'fixtures'/f'{gse}.json').read_text(encoding='utf-8'));lookup={s['gsm']:s for s in meta['samples']};manifest=[]
            for d in p['datasets'].values():
                if d['gse']!=gse:continue
                for sample in d['samples']:
                    original=lookup[sample['gsm']];sample['original_characteristics']=original['fields'].get('Sample_characteristics_ch1',[])
                    if gse=='GSE304862':
                        url=original['fields']['Sample_supplementary_file_1'][0].replace('ftp://','https://');file=root/'fixtures'/gse/url.split('/')[-1];dest=sources/file.name;shutil.copy2(file,dest);sha=file_hash(dest)
                        sample['evidence'].append({'source':url,'locator':'Preserved supplementary file in project sources','value':file.name,'sha256':sha})
                        manifest.append({'gsm':sample['gsm'],'file':file.name,'url':url,'sha256':sha})
                atomic_json(w.folder(p['id'])/'datasets'/d['id']/'manifest.json',d)
            atomic_json(sources/'source_manifest.json',{'gse':gse,'files':manifest,'completed_at':now()})
        w.open_project(project_id=p['id'])
        if homedir=='verified-examples':
            bundle=w.export_project(kind='bundle');shutil.copy2(bundle['path'],root/'fixtures'/Path(bundle['path']).name)
    human=next(p for p in w.state['projects'].values() if 'GSE255988' in p['name']);w.open_project(project_id=human['id']);w.pool.shutdown(wait=True)
print('Original GEO metadata and all supplementary source files retained in verified bundles.')
