"""One-time portable snapshot; routine development does not rebuild this file."""
from pathlib import Path
import hashlib
import shutil
import struct
import subprocess
import sys
import zipfile
import json

root = Path(__file__).resolve().parents[1]
build = root / '.build' / 'portable'
build.mkdir(parents=True, exist_ok=True)
stub = build / 'launcher.exe'
csc = Path(r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe')
config = json.loads((root/'release.json').read_text(encoding='utf-8'))
key = json.loads((root/'release-public-key.json').read_text(encoding='utf-8'))
generated = build/'UpdateConfig.cs'
generated.write_text('using System.Reflection;\n[assembly: AssemblyVersion("'+config['version']+'.0")]\n'
    +'internal static class UpdateConfig {\n'
    +''.join('public const string '+k+' = '+json.dumps(v)+';\n' for k, v in {
        'Version': config['version'], 'RuntimeId': config['runtime_id'], 'Repository': config['repository'],
        'Feed': 'https://github.com/'+config['repository']+'/releases/latest/download/latest.json',
        'Modulus': key['modulus'], 'Exponent': key['exponent']}.items())+'}\n', encoding='utf-8')
subprocess.run([str(csc), '/nologo', '/target:winexe', '/platform:x64', '/optimize+',
                '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
                '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll',
                '/win32icon:' + str(root / 'assets' / 'Omics.ico'), '/out:' + str(stub),
                str(root / 'desktop' / 'PortableLauncher.cs'), str(root/'desktop/PortableUpdates.cs'), str(generated)], check=True)
folder = root / 'release' / 'NozeOmics-win32-x64'
payload = build / 'runtime.zip'
if '--reuse-payload' not in sys.argv or not payload.exists():
    assert json.loads((folder/'resources/app/release.json').read_text()) == config, 'Refresh packaged app before building.'
    with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for file in sorted(folder.rglob('*')):
            relative = file.relative_to(folder)
            if not file.is_file() or relative.parts[0] in {'examples', 'docs'}:
                continue
            if file.name == 'START HERE.md' or '__pycache__' in relative.parts or file.suffix in {'.pyc', '.cs'}:
                continue
            archive.write(file, relative.as_posix())
else:
    with zipfile.ZipFile(payload) as archive:
        assert json.loads(archive.read('resources/app/release.json')) == config, 'Cached payload belongs to another version.'
        for info in archive.infolist():
            relative = Path(info.filename)
            if relative.parts[:2] != ('resources', 'app') or relative.parts[2] == 'runtime' or relative.suffix == '.cs':
                continue
            assert (folder/relative).read_bytes() == archive.read(info), 'Cached application files changed; rebuild without --reuse-payload.'
digest = hashlib.file_digest(payload.open('rb'), 'sha256').hexdigest()
output = build / 'NozeOmics.exe'
shutil.copy2(stub, output)
with output.open('ab') as target, payload.open('rb') as source:
    shutil.copyfileobj(source, target, length=1024*1024)
    target.write(digest.encode('ascii') + struct.pack('<q', payload.stat().st_size) + b'NZOMICS1')
print('Portable executable:', output, round(output.stat().st_size / 1024**2, 1), 'MiB', flush=True)
