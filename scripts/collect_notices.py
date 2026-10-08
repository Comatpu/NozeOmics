from pathlib import Path
import re,shutil,json
root=Path(__file__).resolve().parents[1]
deps=Path('C:/Users/nojae/OneDrive/Desktop/노제/NozeDock v3/frontend/node_modules')
source=(root/'mcp/adapter.cjs').read_text(encoding='utf-8')
packages=set(re.findall(r'node_modules/\.pnpm/([^/]+)/node_modules/((?:@[^/]+/)?[^/]+)/',source))
dest=root/'docs/third-party';dest.mkdir(exist_ok=True)
index=[]
for store,name in sorted(packages):
    folder=deps/'.pnpm'/store/'node_modules'/name
    record=json.loads((folder/'package.json').read_text(encoding='utf-8'))
    prefix=name.replace('/','_').replace('@','')+'-'+record['version']
    copied=[]
    for file in folder.iterdir():
        if file.is_file() and file.name.lower().startswith(('license','licence','copying','notice')):
            target=dest/(prefix+'-'+file.name);shutil.copy2(file,target);copied.append(target.name)
    index.append(f"- {name} {record['version']} — {record.get('license','See package notice')}"+(' ('+', '.join(copied)+')' if copied else ''))
(dest/'NOTICE.md').write_text('# Bundled MCP dependencies\n\n'+'\n'.join(index)+'\n\nPython, R, Electron and their packages retain their notices in their runtime directories.\n',encoding='utf-8')
print('Copied notices for',len(packages),'bundled MCP packages.')
