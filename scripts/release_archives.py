"""Build complete application updates, excluding every user/development file."""
import json
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = json.loads((root/'release.json').read_text(encoding='utf-8'))
release = root/'release/NozeOmics-win32-x64'
app = release/'resources/app'
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
allowed = {'frontend', 'backend', 'desktop', 'mcp', 'assets', 'plugin', 'package.json', 'release.json'}
assert json.loads((app/'release.json').read_text()) == config, 'Packaged resources have not been refreshed.'
assert json.loads((app/'package.json').read_text())['version'] == config['version']

def include(file, relative):
    return (file.is_file() and '__pycache__' not in relative.parts
            and file.suffix not in {'.pyc', '.pyo', '.cs'} and '.local' not in relative.parts)

with zipfile.ZipFile(out/'NozeOmics-app.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(app.rglob('*')):
        relative = file.relative_to(app)
        if relative.parts[0] in allowed and include(file, relative):
            archive.write(file, relative.as_posix())

with zipfile.ZipFile(out/'NozeOmics-runtime.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
    for file in sorted(release.rglob('*')):
        relative = file.relative_to(release)
        if relative.parts[0] not in {'docs', 'examples'} and file.name != 'START HERE.md' and include(file, relative):
            archive.write(file, relative.as_posix())
print('Built app update and complete runtime update.', flush=True)
