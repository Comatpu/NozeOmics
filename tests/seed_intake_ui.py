"""Small deterministic projects for the desktop integration check only."""
import sys
import copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.projects import Workspace
from backend.common import atomic_json, file_hash
root=Path(__file__).resolve().parents[1]
w=Workspace(root,sys.argv[1])
w.open_project(name='Reviewed result study',workflow='direct')
source=w.home/'results.tsv'
source.write_text('gene\tlogFC\tAveExpr\tp\tpadj\nACTB\t1\t4\t0.001\t0.01\nGAPDH\t-1\t3\t0.2\t0.5\n',encoding='utf-8')
recipe={'data_type':'de_result','gene_column':'gene','effect_column':'logFC','effect_scale':'log2','direction':'B_vs_A','identifiers':'symbol','p_column':'p','adjusted_p_column':'padj','average_column':'AveExpr','average_scale':'log2'}
w.import_results(path=source,organism='human',gse='GSE1',recipe=recipe)
w.open_project(name='Pending GEO batch',workflow='intake')
e={'id':'ui-entry','gse':'GSE2','status':'awaiting_review','phase':'Waiting for AI review','generation':1,'groups':{'GSM0':'Group A','GSM1':'Group A','GSM2':'Group B','GSM3':'Group B'},'report':{'title':['A controlled expression study'],'summary':['Intake integration fixture'],'overall_design':['Two control and two treated samples.']},'samples':[{'gsm':'GSM'+str(i),'name':'Sample '+str(i),'organism':'Homo sapiens','source':'cell culture','characteristics':['treatment: '+('control' if i<2 else 'treated')]} for i in range(4)],'files':[{'id':'source','name':'results.tsv','path':str(source),'url':'https://ftp.ncbi.nlm.nih.gov/test.tsv','status':'downloaded','sha256':file_hash(source),'bytes':source.stat().st_size,'owners':['GSE2']}],'dataset_ids':[],'review':None}
w.project()['intake'][e['id']]=e
second=copy.deepcopy(e)
second.update(id='ui-second',gse='GSE3')
w.project()['intake'][second['id']]=second
w.save();w.pool.shutdown(wait=True)
