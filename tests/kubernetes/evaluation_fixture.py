"""Deterministic provider fixture. Exercises the wire contract, never claims model quality."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

requests = []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, value):
        content = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)
    def do_GET(self):
        self.send({'requests': requests} if self.path == '/evidence' else {'ready': True})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        content = body['messages'][1]['content']
        data = json.loads(content[0]['text'])
        requests.append({'model': body['model'], 'content_types': [item['type'] for item in content],
            'material': data['material'], 'format': body['response_format']['type']})
        actual = data['material']['actual']
        score = 0 if 'wrong' in str(actual.get('answer', '')) else 1
        result = {'score': score, 'reason': 'Contract fixture decision only', 'evidence': ['actual', 'evidence:0']}
        self.send({'model': 'contract-fixture', 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(result)}}]})

if __name__ == '__main__':
    HTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
