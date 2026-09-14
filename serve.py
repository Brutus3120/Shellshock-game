#!/usr/bin/env python3
"""
serve.py — micro-serveur local pour ÉCLAT.

Les modules JavaScript (`<script type="module">`) ne se chargent pas depuis un
fichier ouvert en file://, à cause de la politique d'origine des navigateurs.
Il faut donc un serveur — mais un serveur *local*, qui n'expose rien :
on écoute sur 127.0.0.1 uniquement, et rien ne sort de la machine.

Usage :
    python3 serve.py             # port 8000, ouvre le navigateur
    python3 serve.py 8080        # autre port
    python3 serve.py --no-open   # sans ouvrir le navigateur
"""

import http.server
import os
import socketserver
import sys
import threading
import webbrowser

HOST = "127.0.0.1"          # jamais 0.0.0.0 : le jeu n'a pas à être joignable du réseau
DEFAULT_PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Pas de cache : on modifie le jeu et on recharge, sans surprise.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass        # console silencieuse


def main():
    args = [a for a in sys.argv[1:]]
    open_browser = "--no-open" not in args
    args = [a for a in args if not a.startswith("--")]
    port = int(args[0]) if args else DEFAULT_PORT

    socketserver.TCPServer.allow_reuse_address = True
    for attempt in range(20):
        try:
            httpd = socketserver.TCPServer((HOST, port), Handler)
            break
        except OSError:
            port += 1
    else:
        print("Aucun port libre trouvé.", file=sys.stderr)
        return 1

    url = f"http://{HOST}:{port}/"
    print("=" * 52)
    print("  ÉCLAT — FPS arcade hors-ligne")
    print(f"  Ouvrez : {url}")
    print("  Ctrl+C pour arrêter le serveur.")
    print("=" * 52)
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServeur arrêté.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
