#!/usr/bin/env python3
"""
MASS HQ — Dashboard Proxy Server
Serves static files on port 8080 AND proxies agent API calls.

Proxy routes:
  /api/8020/* → http://localhost:8020/*
  /api/8006/* → http://localhost:8006/*
  /api/8007/* → http://localhost:8007/*
  /api/8008/* → http://localhost:8008/*

This eliminates CORS errors because the browser only ever
talks to 192.168.12.10:8080 (same origin as the dashboard).
"""

import http.server
import urllib.request
import urllib.error
import socketserver
import os
import json

PORT      = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Map of proxy prefixes → backend ports
PROXY_MAP = {
    '/api/8020': 'http://localhost:8020',
    '/api/8006': 'http://localhost:8006',
    '/api/8007': 'http://localhost:8007',
    '/api/8009': 'http://localhost:8009',
    '/api/8021': 'http://localhost:8021',
    '/api/8008': 'http://localhost:8008',
}

CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
}

class ProxyHandler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Suppress per-request logs (keep terminal clean)
        pass

    def send_cors(self):
        for k, v in CORS_HEADERS.items():
            self.send_header(k, v)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        for prefix, backend in PROXY_MAP.items():
            if self.path.startswith(prefix):
                backend_path = self.path[len(prefix):]
                if not backend_path.startswith('/'):
                    backend_path = '/' + backend_path
                target = backend + backend_path
                try:
                    req  = urllib.request.Request(target, headers={'Accept': 'application/json'})
                    resp = urllib.request.urlopen(req, timeout=4)
                    body = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(body)
                except urllib.error.URLError as e:
                    err = json.dumps({'error': str(e), 'target': target}).encode()
                    self.send_response(502)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(err)
                return

        # Not a proxy path → serve static file normally
        super().do_GET()

    def do_POST(self):
        for prefix, backend in PROXY_MAP.items():
            if self.path.startswith(prefix):
                backend_path = self.path[len(prefix):]
                if not backend_path.startswith('/'):
                    backend_path = '/' + backend_path
                target  = backend + backend_path
                length  = int(self.headers.get('Content-Length', 0))
                body_in = self.rfile.read(length) if length else b''
                try:
                    req  = urllib.request.Request(target, data=body_in,
                                                   headers={'Content-Type': 'application/json'})
                    resp = urllib.request.urlopen(req, timeout=4)
                    body = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(body)
                except urllib.error.URLError as e:
                    err = json.dumps({'error': str(e)}).encode()
                    self.send_response(502)
                    self.send_header('Content-Type', 'application/json')
                    self.send_cors()
                    self.end_headers()
                    self.wfile.write(err)
                return
        super().do_GET()  # fallback


class ThreadedServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads      = True


if __name__ == '__main__':
    os.chdir(DIRECTORY)
    with ThreadedServer(('', PORT), ProxyHandler) as httpd:
        print(f'MASS Proxy Server running on http://localhost:{PORT}')
        print(f'Proxying: {" ".join(PROXY_MAP.keys())}')
        httpd.serve_forever()
