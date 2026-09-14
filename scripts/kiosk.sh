#!/bin/bash
# Sobe o painel na TV: atualiza o repo, serve a pagina localmente e mantem o
# Chromium em kiosk vivo. Roda dentro da sessao grafica (chamado pelo autostart),
# por isso herda WAYLAND_DISPLAY e XDG_RUNTIME_DIR sem precisar exporta-los.
#
# Instalacao: veja o README.md do repositorio.

set -u

REPO="$HOME/painel-scroll"
PORT=8080
PROFILE="$HOME/kiosk-profile"
LOG="$HOME/kiosk.log"

# Tag exclusiva da URL. E o que o pgrep procura para saber se o Chromium esta
# vivo. NAO usar "painel-scroll" aqui: essa string tambem aparece na linha de
# comando do http.server (--directory ~/painel-scroll) e deste proprio script
# (~/painel-scroll/scripts/kiosk.sh), entao o pgrep acharia match sempre e o
# navegador nunca seria relancado depois de uma queda.
TAG="painel-scroll-kiosk"
URL="http://localhost:$PORT/?$TAG"

log() {
  echo "$(date '+%F %T') $*" >> "$LOG"
}

# Evita o log crescer sem limite em uma maquina que fica meses ligada.
[ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 1048576 ] && : > "$LOG"
log "--- kiosk.sh iniciado ---"

# 1. Espera a rede subir.
until ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; do sleep 2; done
sleep 5

# 2. Atualiza o codigo. Com timeout e sem --rebase: se o GitHub estiver fora ou
#    o clone tiver alteracao local, o painel sobe com a versao que ja esta em disco.
if [ -d "$REPO/.git" ]; then
  if timeout 60 git -C "$REPO" pull --ff-only >/dev/null 2>&1; then
    log "git pull: ok ($(git -C "$REPO" rev-parse --short HEAD))"
  else
    log "git pull: falhou ou sem fast-forward; seguindo com a copia local"
  fi
else
  log "AVISO: $REPO nao e um clone git; seguindo com o que existe na pasta"
fi

# 3. Servidor estatico local. Servir por http:// (e nao file://) e o que permite
#    ler o manifest das imagens sem CORS e funcionar sem internet.
if ! pgrep -f "http.server $PORT" >/dev/null; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$REPO" \
    >/dev/null 2>&1 &
  log "http.server iniciado na porta $PORT"
fi

# Espera a porta responder antes de abrir o navegador (ate ~5 s).
for _ in $(seq 1 25); do
  (echo > /dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1 && break
  sleep 0.2
done

# 4. Suprime o aviso de "encerramento incorreto" do Chromium. Aponta para o
#    perfil dedicado do kiosk, nao para o perfil padrao.
PREF="$PROFILE/Default/Preferences"
if [ -f "$PREF" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$PREF"
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$PREF"
fi

BROWSER=$(command -v chromium-browser || command -v chromium)
if [ -z "$BROWSER" ]; then
  log "ERRO: Chromium nao encontrado"
  exit 1
fi

# 5. Loop de supervisao: a cada 20 s, relanca o navegador se ele nao estiver vivo.
while true; do
  if ! pgrep -f "$TAG" >/dev/null; then
    rm -f "$PROFILE/Singleton"*
    log "relancando o Chromium"
    "$BROWSER" \
      --kiosk \
      --password-store=basic \
      --noerrdialogs \
      --disable-infobars \
      --disable-session-crashed-bubble \
      --disable-features=TranslateUI \
      --check-for-update-interval=31536000 \
      --autoplay-policy=no-user-gesture-required \
      --disable-pinch \
      --overscroll-history-navigation=0 \
      --disable-web-security \
      --user-data-dir="$PROFILE" \
      --no-first-run \
      "$URL" &
      # Se aparecer a infobar "flag nao suportada" na TV, acrescente --test-type
      # na lista acima (suprime esse aviso especifico).
  fi
  sleep 20
done
