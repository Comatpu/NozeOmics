from pathlib import Path
import requests,zipfile
root=Path(__file__).resolve().parents[1]
dest=root/'runtime/python'
dest.mkdir(parents=True,exist_ok=True)
archive=root/'runtime/python-3.12.10-embed-amd64.zip'
if not archive.exists():
    r=requests.get('https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',timeout=120);r.raise_for_status();archive.write_bytes(r.content)
with zipfile.ZipFile(archive) as z:z.extractall(dest)
(dest/'python312._pth').write_text('python312.zip\n.\n..\\..\nLib\\site-packages\nimport site\n')
print(dest)
