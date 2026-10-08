"""Apply the capability extension to an extracted Cell 5 renderer idempotently."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
target = root/'frontend/explorer.js'
text = target.read_text(encoding='utf-8')
marker = '// This runs inside the existing explorer closure. Keep submitted results distinct.'
if marker in text:
    text = text[:text.index(marker)] + text[text.index('restoreView(data.view);', text.index(marker)):]
text = text.replace('const mode=state.modes[di];if(mode', "const mode=d.result_only&&state.modes[di]!=='hidden'?'mean':state.modes[di];if(mode")
extension = (root/'frontend/capability-extension.js').read_text(encoding='utf-8')
index = text.index('restoreView(data.view);')
text = text[:index]+extension+'\n'+text[index:]
target.write_text(text, encoding='utf-8')
html = root/'frontend/explorer.html'
content = html.read_text(encoding='utf-8')
if 'capabilities.css' not in content:
    html.write_text(content.replace('</head>', '<link rel="stylesheet" href="capabilities.css"></head>'), encoding='utf-8')
