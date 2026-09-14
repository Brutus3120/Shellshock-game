#!/usr/bin/env bash
# Lance ÉCLAT. Nécessite uniquement Python 3 (présent par défaut sur Linux/macOS).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 serve.py "$@"; fi
if command -v python  >/dev/null 2>&1; then exec python  serve.py "$@"; fi
echo "Python 3 est introuvable. Installez-le depuis https://www.python.org/downloads/" >&2
exit 1
