"""Serve readonly prototype-derived visual fixtures. No database, writes, or real execution claims."""
import argparse
import base64
import hashlib
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=18800)
args = parser.parse_args()
fixtures = root / '.data/visual-fixtures'
routes = json.loads((fixtures / 'responses.json').read_text())

class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def respond(self, data, content_type='application/json', status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_POST(self): self.respond(b'{"message":"Readonly visual fixture"}', status=405)
    do_PUT = do_POST
    do_DELETE = do_POST
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/api/v1/live' and self.headers.get('Upgrade', '').lower() == 'websocket':
            key = self.headers.get('Sec-WebSocket-Key', '')
            accept = base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101)
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
            self.send_header('Sec-WebSocket-Accept', accept)
            self.end_headers()
            try:
                while self.rfile.read(1): pass
            except ConnectionError: pass
            return
        if path.startswith('/api/v1/media/'):
            identifier = path.rsplit('/', 1)[-1]
            asset = routes.get('/assets/'+identifier, {}).get('data', {})
            url = asset.get('fixture_url') or ''
            if url.startswith('data:'):
                from urllib.parse import unquote_to_bytes
                self.respond(unquote_to_bytes(url.split(',', 1)[1]), url.split(';')[0][5:]); return
            path = '/fixtures/tone.wav'
        if path.startswith('/api/v1/'):
            route = path.removeprefix('/api/v1')
            if route.startswith('/modules/') and '/files/' in route:
                self.respond((root/'examples/modules/common/ui.js').read_bytes(), 'text/javascript'); return
            response = routes.get(route)
            if response is None: self.respond(b'{"code":"fixture_not_found","message":"Missing visual fixture"}', status=404)
            else: self.respond(json.dumps(response, ensure_ascii=False).encode())
            return
        if path == '/prototype.html': file = fixtures / 'prototype.html'
        elif path == '/fixtures/tone.wav': file = fixtures / 'tone.wav'
        else:
            file = (root / 'web/dist' / path.lstrip('/')).resolve()
            if not file.is_relative_to((root / 'web/dist').resolve()): self.send_error(404); return
            if not file.is_file(): file = root / 'web/dist/index.html'
        if file.is_file(): self.respond(file.read_bytes(), self.guess_type(str(file)))
        else: self.send_error(404)

print(f'Readonly visual fixture server: http://127.0.0.1:{args.port}', flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
