import sys,json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from backend.imports import geo_metadata
def fetch(gse):
    meta=geo_metadata(gse)
    (root/'fixtures'/f'{gse}.soft').write_text(meta.pop('raw_text'),encoding='utf-8')
    (root/'fixtures'/f'{gse}.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    print(gse,len(meta['samples']),flush=True)
with ThreadPoolExecutor(2) as pool:list(pool.map(fetch,['GSE255988','GSE304862']))
