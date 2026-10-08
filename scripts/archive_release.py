from pathlib import Path
import zipfile,hashlib
root=Path(__file__).resolve().parents[1]
folder=root/'release/NozeOmics-win32-x64';target=root/'release/NozeOmics-0.1-Windows-x64.zip'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=5) as archive:
    for p in sorted(folder.rglob('*')):
        if p.is_file():archive.write(p,p.relative_to(folder.parent))
sha=hashlib.sha256()
with target.open('rb') as stream:
    for block in iter(lambda:stream.read(1024*1024),b''):sha.update(block)
(target.with_suffix('.sha256')).write_text(sha.hexdigest()+'  '+target.name+'\n')
print(target,round(target.stat().st_size/1024**2,1),'MiB',flush=True)
