"""One loopback service shared by the desktop viewer and all MCP clients."""
from __future__ import annotations
import argparse
import json
import mimetypes
import os
import secrets
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from .common import Problem, atomic_json, encoded
from .projects import Workspace
from .migration import migrate_legacy

METHODS = ['open_project','prepare_import','inspect_source','fetch_source','import_dataset','configure_comparison','update_view','start_analysis','get_job','control_job','get_evidence','inspect_dataset','export_project','viewer_receipt','restore_project','import_panel','add_gses','update_intake','get_intake','review_intake','import_results','select_intake_files']

def serve(root, home, port=0):
    root, home = Path(root).resolve(), Path(home).resolve()
    migrate_legacy(home)
    workspace = Workspace(root, home)
    token = secrets.token_urlsafe(32)
    reviewer_token = secrets.token_urlsafe(32)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def send(self, code, value, content_type='application/json'):
            body = value if isinstance(value, bytes) else encoded(value)
            self.send_response(code)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cross-Origin-Resource-Policy','same-origin')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
            self.end_headers()
            self.wfile.write(body)
        def allowed(self, auth=False):
            authority = f'127.0.0.1:{self.server.server_port}'
            if self.headers.get('Host') != authority:
                raise Problem('host_rejected','Invalid local service host.')
            origin = self.headers.get('Origin')
            if origin and origin != 'http://'+authority:
                raise Problem('origin_rejected','External pages cannot modify this project.')
            if auth and not secrets.compare_digest(self.headers.get('Authorization',''), 'Bearer '+token):
                raise Problem('authentication_required','The local connection token is missing or expired.')
        def do_GET(self):
            try:
                self.allowed()
                path = urlsplit(self.path).path
                if path=='/health':
                    return self.send(200,{'ready':True,'version':workspace.snapshot()['version']})
                if path in {'/api/state','/api/payload'}:
                    self.allowed(True)
                    return self.send(200,workspace.snapshot() if path.endswith('state') else workspace.payload())
                if path=='/bootstrap.js':
                    return self.send(200,('window.NOZEOMICS='+json.dumps({'token':token,'home':str(home),'version':workspace.snapshot()['version']})+';').encode(),'text/javascript')
                if path in {'/','/index.html'}:
                    target=root/'frontend/index.html'
                elif path=='/explorer.html':
                    target=root/'frontend/explorer.html'
                elif path.startswith('/assets/'):
                    target=(root/path.lstrip('/')).resolve()
                    if not target.is_relative_to(root/'assets'):
                        raise Problem('file_rejected','Invalid asset path.')
                else:
                    target=(root/'frontend'/path.lstrip('/')).resolve()
                    if not target.is_relative_to(root/'frontend'):
                        raise Problem('file_rejected','Invalid viewer path.')
                if not target.is_file():
                    return self.send(404,{'error':'Not found'})
                self.send(200,target.read_bytes(),mimetypes.guess_type(str(target))[0] or 'application/octet-stream')
            except Problem as exc:
                self.send(403,{'error':exc.record()})
        def do_POST(self):
            try:
                self.allowed(True)
                length=int(self.headers.get('Content-Length',0))
                if length>16*1024*1024:
                    raise Problem('request_too_large','Use a file artifact for a large input.')
                request=json.loads(self.rfile.read(length))
                method=urlsplit(self.path).path.removeprefix('/api/')
                if method=='shutdown':
                    for event in workspace.cancels.values():
                        event.set()
                    self.send(200,{'shutting_down':True})
                    threading.Thread(target=httpd.shutdown,daemon=True).start()
                    return
                if method not in METHODS or not hasattr(workspace,method):
                    raise Problem('unknown_tool','Unknown project action.')
                if method in {'review_intake','select_intake_files'} and not secrets.compare_digest(self.headers.get('X-NozeOmics-Reviewer',''), reviewer_token):
                    raise Problem('ai_review_required','Only the connected AI reviewer can approve an intake batch.')
                result=getattr(workspace,method)(**request)
                self.send(200,result)
            except Problem as exc:
                self.send(409 if exc.code=='revision_conflict' else 400,{'error':exc.record()})
            except Exception as exc:
                traceback.print_exc()
                self.send(400,{'error':{'code':'request_failed','message':str(exc)}})
    httpd=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    connection={'url':f'http://127.0.0.1:{httpd.server_port}','token':token,'reviewer_token':reviewer_token,'pid':os.getpid(),'root':str(root),'home':str(home)}
    atomic_json(home/'connection.json',connection)
    print(json.dumps(connection),flush=True)
    try:
        httpd.serve_forever(poll_interval=.2)
    finally:
        for event in workspace.cancels.values():
            event.set()
        workspace.pool.shutdown(wait=True)
        workspace.source_pool.shutdown(wait=True)
        httpd.server_close()
        (home/'connection.json').unlink(missing_ok=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument('--home',required=True)
    parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args()
    serve(args.root,args.home,args.port)
