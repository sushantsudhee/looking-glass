#!/usr/bin/env python3
"""
Local dev proxy for Looking Glass.
Serves static files and proxies /api/* → https://api.moloco.cloud/*
and /brg/* → https://cfe-gateway-rp76syjtkq-uc.a.run.app/*
so that CORS isn't an issue during local development.

Usage: python3 proxy.py [port]
"""

import http.server
import urllib.request
import urllib.error
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

PROXY_ROUTES = {
    '/api/': 'https://api.moloco.cloud/',
    '/brg/': 'https://cfe-gateway-rp76syjtkq-uc.a.run.app/',
}

# Headers from the client that we forward upstream
FORWARD_REQUEST_HEADERS = {
    'content-type', 'authorization', 'accept',
    'moloco-bff-auth', 'moloco-bff-name',
}

# Headers from upstream that we pass back (minus hop-by-hop)
SKIP_RESPONSE_HEADERS = {
    'transfer-encoding', 'connection', 'keep-alive',
    'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'upgrade',
}


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # ── CORS pre-flight ───────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ── Proxy target detection ─────────────────────────────────────────────
    def _proxy_target(self):
        for prefix, upstream in PROXY_ROUTES.items():
            if self.path.startswith(prefix):
                return upstream + self.path[len(prefix):]
        return None

    # ── CORS headers helper ────────────────────────────────────────────────
    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers',
                         'Content-Type, Authorization, Moloco-Bff-Auth, Moloco-Bff-Name')
        self.send_header('Access-Control-Expose-Headers', '*')

    # ── Generic proxy handler ──────────────────────────────────────────────
    def _do_proxy(self, method):
        target = self._proxy_target()
        if not target:
            # Fall through to static file serving
            if method == 'GET':
                super().do_GET()
            else:
                self.send_error(404)
            return

        # Build upstream request
        body = None
        content_len = int(self.headers.get('Content-Length', 0) or 0)
        if content_len:
            body = self.rfile.read(content_len)

        upstream_headers = {}
        for key, val in self.headers.items():
            if key.lower() in FORWARD_REQUEST_HEADERS:
                upstream_headers[key] = val

        req = urllib.request.Request(target, data=body, headers=upstream_headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                self.send_response(resp.status)
                self._cors_headers()
                for key, val in resp.headers.items():
                    if key.lower() not in SKIP_RESPONSE_HEADERS:
                        self.send_header(key, val)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._cors_headers()
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(str(e).encode())

    def do_GET(self):
        if self._proxy_target():
            self._do_proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        self._do_proxy('POST')

    def log_message(self, fmt, *args):
        # Quieter logging — skip successful static file hits
        if args and str(args[1]) == '200' and not self.path.startswith(('/api/', '/brg/')):
            return
        super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(STATIC_DIR)
    with http.server.ThreadingHTTPServer(('', PORT), Handler) as httpd:
        print(f'Looking Glass dev proxy → http://localhost:{PORT}')
        print(f'  /api/* proxied to https://api.moloco.cloud/')
        print(f'  /brg/* proxied to https://cfe-gateway-rp76syjtkq-uc.a.run.app/')
        httpd.serve_forever()
