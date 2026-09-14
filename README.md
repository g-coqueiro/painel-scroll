# painel-scroll

Painel exibido 24/7 em uma TV de fábrica: espelha o dashboard de eficiência energética
(<https://whitebox.isso.digital/UwiGFDAXcl5v/>) e adiciona o scroll automático que o
dashboard original não tem.

Roda em um Raspberry Pi 4 com Chromium em modo kiosk. O contexto completo do projeto
(decisões, restrições e roadmap) está em [CLAUDE.md](CLAUDE.md).

## Como funciona

```
Boot → autologin no desktop → ~/.config/autostart/kiosk.desktop
  → ~/painel-scroll/scripts/kiosk.sh
      1. espera a rede
      2. git pull (com timeout; se falhar, usa a cópia local)
      3. sobe python3 -m http.server 8080 servindo o repositório
      4. loop: mantém o Chromium aberto em http://localhost:8080/?painel-scroll-kiosk
Cron 04:00 → pkill -f chromium → o loop reabre o navegador limpo
```

A página (`index.html`) opera em dois modos e escolhe sozinha a cada carga do iframe:

| Modo | Quando | Altura | Scroll |
|---|---|---|---|
| `inner` | Chromium com `--disable-web-security` (o do kiosk) | lida em tempo real do documento | `contentWindow.scrollTo` |
| `outer` | qualquer navegador normal, incluindo GitHub Pages | fixa, `CONFIG.fallbackHeightPx` | `translateY` no iframe |

No modo `inner` o painel acompanha o crescimento do dashboard sozinho: ninguém precisa
medir altura nem fazer commit quando um gráfico novo é adicionado. O modo `outer` é o
fallback — funciona como antes, com a altura manual, e garante que a TV não fica preta
se a flag deixar de existir em uma atualização do Chromium.

Todos os parâmetros ajustáveis (URL, durações, altura de fallback, CSS injetado)
estão no objeto `CONFIG`, no topo do `<script>` do `index.html`.

## Instalação no Raspberry Pi

Feita uma vez, como usuário `gcoqueiro`.

**1. Autologin no desktop**

```bash
sudo raspi-config
# System Options → Boot / Auto Login → Desktop Autologin
```

**2. Clonar o repositório**

```bash
git clone https://github.com/g-coqueiro/painel-scroll.git ~/painel-scroll
chmod +x ~/painel-scroll/scripts/kiosk.sh
```

**3. Autostart**

```bash
mkdir -p ~/.config/autostart
cp ~/painel-scroll/scripts/kiosk.desktop ~/.config/autostart/kiosk.desktop
```

**4. Reinício diário do navegador (cron)**

```bash
crontab -e
```

Acrescente:

```
0 4 * * * pkill -f chromium
```

O loop do `kiosk.sh` reabre o Chromium em até 20 s, com o perfil limpo.

**5. Reiniciar**

```bash
sudo reboot
```

Se houver um `~/kiosk.sh` antigo, ele pode ser removido depois que o painel subir pela
nova cadeia — o `kiosk.desktop` deste repositório já aponta para `~/painel-scroll/scripts/kiosk.sh`.

## Diagnóstico

```bash
tail -f ~/kiosk.log                  # o que o kiosk.sh fez no boot e nos relançamentos
pgrep -af painel-scroll-kiosk        # o Chromium está vivo?
curl -sI http://localhost:8080/      # o servidor local está de pé?
```

Para rodar algum comando gráfico por SSH (fora da sessão do desktop), exporte antes:

```bash
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/run/user/$(id -u)
```

Para conferir em qual modo a página entrou, abra o DevTools na TV ou rode no console
da própria página: `frame.contentDocument` — se vier um documento, está no modo `inner`.

### Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Fim do dashboard cortado | caiu no modo `outer` (flag não aplicada) | conferir se `--disable-web-security` e `--user-data-dir` estão na linha de comando do Chromium (`pgrep -af chromium`) |
| Tela em branco | servidor local não subiu | `tail ~/kiosk.log`, checar `python3 -m http.server` |
| Chromium não relança sozinho | padrão do `pgrep` batendo em outro processo | o padrão precisa ser exclusivo da URL (`painel-scroll-kiosk`) |
| Gráfico novo não aparece | reload ainda não ocorreu | acontece ao fim de cada ciclo de scroll; `CONFIG.reloadOnCycleEnd` |

## Desenvolvimento

Sem build step, sem dependências. Para testar na máquina local:

```bash
python3 -m http.server 8080 --directory .
```

Abra <http://localhost:8080/>. Em um navegador normal a página roda no modo `outer`
(fallback), que é exatamente o comportamento que a TV terá se a flag falhar — é o
cenário que mais importa validar antes de subir.
