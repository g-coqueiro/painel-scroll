#!/bin/bash
# Sincroniza as imagens do slideshow da pasta compartilhada do Drive para o RPi
# e regenera o manifest que a pagina le. Roda por cron a cada 5 min.
#
# A pasta do Drive NAO e identificada aqui: o repositorio e publico e o ID da
# pasta e um link de acesso. Ele fica no remote do rclone (root_folder_id em
# ~/.config/rclone/rclone.conf), fora do versionamento. Veja o README.md.

set -u

# cron nao herda o PATH da sessao interativa.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

REPO="$HOME/painel-scroll"
IMAGES="$REPO/images"
REMOTE="${PAINEL_RCLONE_REMOTE:-gdrive:}"
LOG="$HOME/sync-images.log"
LOCK="/tmp/painel-sync-images.lock"

log() {
  echo "$(date '+%F %T') $*" >> "$LOG"
}

[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 1048576 ] && : > "$LOG"

# Uma sincronizacao lenta nao pode se sobrepor a proxima do cron.
exec 9>"$LOCK"
if ! flock -n 9; then
  log "sync anterior ainda rodando; pulando"
  exit 0
fi

if ! command -v rclone >/dev/null; then
  log "ERRO: rclone nao instalado"
  exit 1
fi

mkdir -p "$IMAGES"

# --max-delete e uma rede de seguranca: se o remote responder vazio por algum
# problema de permissao, o sync apagaria todas as imagens da TV de uma vez.
if rclone sync "$REMOTE" "$IMAGES" \
  --include "*.{jpg,jpeg,png,webp}" \
  --include "*.{JPG,JPEG,PNG,WEBP}" \
  --max-delete 20 \
  --retries 3 \
  --timeout 60s \
  --quiet 2>>"$LOG"; then
  log "rclone sync: ok"
else
  log "rclone sync: falhou (codigo $?); mantendo as imagens que ja estao em disco"
fi

# O manifest e sempre regenerado a partir do que existe em disco, mesmo se o
# sync falhou: assim ele nunca aponta para um arquivo que nao esta la.
TOTAL=$(python3 - "$IMAGES" <<'PY'
import json, os, sys, time

pasta = sys.argv[1]
extensoes = {'.jpg', '.jpeg', '.png', '.webp'}

# Ordem alfabetica: o dono do conteudo controla a sequencia com prefixo
# numerico nos nomes dos arquivos (01_, 02_, ...).
itens = []
for nome in sorted(os.listdir(pasta)):
    caminho = os.path.join(pasta, nome)
    if not os.path.isfile(caminho):
        continue
    if os.path.splitext(nome)[1].lower() not in extensoes:
        continue
    itens.append({'name': nome, 'mtime': int(os.path.getmtime(caminho))})

# Escrita atomica: a pagina pode estar lendo o manifest neste instante.
temporario = os.path.join(pasta, 'manifest.json.tmp')
with open(temporario, 'w', encoding='utf-8') as arquivo:
    json.dump({'generated': int(time.time()), 'images': itens}, arquivo,
              ensure_ascii=False, indent=1)
os.replace(temporario, os.path.join(pasta, 'manifest.json'))

print(len(itens))
PY
) || { log "ERRO: falha ao gerar o manifest"; exit 1; }

log "manifest gerado com $TOTAL imagem(ns)"
