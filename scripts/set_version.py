"""Change the release version before building; never publishes anything."""
import argparse
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('version')
parser.add_argument('--runtime-id', help='Change only when Electron/Python/R or native dependencies change.')
args = parser.parse_args()
if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', args.version):
    parser.error('Version must be major.minor.patch, such as 0.2.1.')
root = Path(__file__).resolve().parents[1]
release = json.loads((root/'release.json').read_text(encoding='utf-8'))
package = json.loads((root/'package.json').read_text(encoding='utf-8'))
release['version'] = package['version'] = args.version
if args.runtime_id:
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,60}', args.runtime_id):
        parser.error('Runtime ID must be a simple identifier.')
    release['runtime_id'] = args.runtime_id
for filename, content in [('release.json', release), ('package.json', package)]:
    (root/filename).write_text(json.dumps(content, indent=2)+'\n', encoding='utf-8')
print('Local version set to', args.version, '(not published).')
