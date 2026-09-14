#!/usr/bin/env python3
"""Servidor estatico do painel, com cache desligado.

O `python3 -m http.server` manda Last-Modified e responde 304, entao o Chromium
guarda os arquivos: depois de um `git pull` a TV podia continuar rodando o
codigo antigo por tempo indeterminado, sem ninguem perceber. Como este servidor
so serve o painel para o proprio aparelho, em localhost, cache nao traz nenhum
ganho e custa deploys silenciosamente ignorados.

Uso: serve.py <porta> <pasta>
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class SemCache(SimpleHTTPRequestHandler):

    def send_head(self):
        # Ignora revalidacao condicional: aqui a resposta e sempre o arquivo
        # que esta em disco agora.
        for cabecalho in ('If-Modified-Since', 'If-None-Match'):
            if cabecalho in self.headers:
                del self.headers[cabecalho]
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 1

    porta = int(sys.argv[1])
    pasta = sys.argv[2]

    manipulador = partial(SemCache, directory=pasta)
    servidor = ThreadingHTTPServer(('127.0.0.1', porta), manipulador)
    servidor.serve_forever()
    return 0


if __name__ == '__main__':
    sys.exit(main())
