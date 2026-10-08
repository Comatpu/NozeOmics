from pathlib import Path
import zipfile,json
root=Path(__file__).resolve().parents[1]
dependency=Path('C:/Users/nojae/OneDrive/Desktop/노제/NozeDock v3/frontend/node_modules/electron')
version=json.loads((dependency/'package.json').read_text())['version']
target=root/'.build/electron-cache'/f'electron-v{version}-win32-x64.zip';target.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(target,'w',zipfile.ZIP_STORED) as archive:
    for p in (dependency/'dist').rglob('*'):
        if p.is_file():archive.write(p,p.relative_to(dependency/'dist'))
print(target)
