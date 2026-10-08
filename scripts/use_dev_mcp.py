"""Point only NozeOmics's local MCP registration at the mutable development runtime."""
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
root = Path(__file__).resolve().parents[1]
target = Path.home()/'.codex/config.toml'
text = target.read_text(encoding='utf-8')
exe = str(root/'release/NozeOmics-win32-x64/NozeOmics.exe')
adapter = str(root/'mcp/adapter.cjs')
def section(name, replacements):
    global text
    pattern = r'(?ms)^\['+re.escape(name)+r'\]\n(.*?)(?=^\[|\Z)'
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError('Existing NozeOmics MCP registration was not found.')
    body = match.group(1)
    for key, value in replacements.items():
        line = key+' = '+json.dumps(value, ensure_ascii=False)
        if not re.search(r'(?m)^'+re.escape(key)+r'\s*=', body):
            raise RuntimeError('Expected existing setting: '+key)
        body = re.sub(r'(?m)^'+re.escape(key)+r'\s*=.*$', lambda _: line, body)
    text = text[:match.start(1)]+body+text[match.end(1):]
section('mcp_servers.nozeomics', {'command': exe, 'args': [adapter]})
section('mcp_servers.nozeomics.env', {'NOZEOMICS_EXE': exe})
backup = target.with_name('config.toml.before-nozeomics-intake-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.bak')
shutil.copy2(target, backup)
target.write_text(text, encoding='utf-8')
print('Updated only the NozeOmics MCP development entry; existing shared data home and other servers retained.')
