import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from backend.projects import Workspace
w=Workspace(root,root/'.local/user-workspace')
if not w.state['projects']:
    for path in sorted((root/'fixtures').glob('*.nozeomics.zip')):w.restore_project(str(path))
    p=next(p for p in w.state['projects'].values() if 'GSE255988' in p['name']);w.open_project(project_id=p['id']);w.update_view(view={'graphType':'ma'})
w.pool.shutdown(wait=True)
print(w.home)
