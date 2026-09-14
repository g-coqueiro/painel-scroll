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

O ciclo do painel:

```
1. Scroll do dashboard: desce → sobe
2. Lê images/manifest.json
   ├─ vazio ou inacessível → recarrega o dashboard e volta ao passo 1
   └─ com imagens → slideshow em tela cheia (o dashboard recarrega escondido atrás dele)
3. Volta ao passo 1, já com o dashboard atualizado
```

Os arquivos: `index.html` (esqueleto), `style.css`, `app.js` (toda a lógica, com o `CONFIG`
no topo), `scripts/kiosk.sh` (boot) e `scripts/sync-images.sh` (imagens do Drive).

A página opera em dois modos e escolhe sozinha a cada carga do iframe:

| Modo | Quando | Altura | Scroll |
|---|---|---|---|
| `inner` | Chromium com `--disable-web-security` (o do kiosk) | lida em tempo real do documento | `contentWindow.scrollTo` |
| `outer` | qualquer navegador normal, incluindo GitHub Pages | fixa, `CONFIG.fallbackHeightPx` | `translateY` no iframe |

No modo `inner` o painel acompanha o crescimento do dashboard sozinho: ninguém precisa
medir altura nem fazer commit quando um gráfico novo é adicionado. O modo `outer` é o
fallback — funciona como antes, com a altura manual, e garante que a TV não fica preta
se a flag deixar de existir em uma atualização do Chromium.

Todos os parâmetros ajustáveis (URL, durações, altura de fallback, CSS injetado,
tempo por imagem) estão no objeto `CONFIG`, no topo do `app.js`.

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

**5. Imagens do slideshow (rclone + Google Drive)**

O painel exibe as imagens de uma pasta compartilhada do Drive entre um ciclo de scroll e
outro. Quem tem acesso à pasta sobe imagem lá; em até 10 min ela aparece na TV.

> O ID da pasta **não fica no repositório** — ele é um link de acesso e o repo é público.
> Ele vive só no `~/.config/rclone/rclone.conf` do RPi, que não é versionado.

Instale o rclone e gere o token em um PC **com navegador** (o RPi é headless):

```bash
sudo apt install rclone
```

No PC com navegador, com o rclone instalado:

```bash
rclone authorize "drive"
```

Faça login com a conta que tem acesso à pasta e copie o token que aparece no terminal.
De volta ao RPi:

```bash
rclone config
```

- `n` (novo remote), nome: **gdrive**
- tipo: **drive**
- `client_id` e `client_secret`: em branco
- `scope`: **1** (ou `drive.readonly`, se a conta só precisa ler)
- configuração avançada: **y**, e em `root_folder_id` cole o ID da pasta — é o trecho da
  URL do Drive depois de `/folders/`
- "Use auto config?": **n**, e cole o token gerado no outro PC

Se a pasta for de outra pessoa e você preferir não usar o `root_folder_id`, use
`shared_with_me = true` no lugar.

Teste e agende:

```bash
rclone lsd gdrive:                     # deve listar a pasta sem pedir login
~/painel-scroll/scripts/sync-images.sh # primeira sincronização
cat ~/painel-scroll/images/manifest.json
```

```bash
crontab -e
```

```
*/5 * * * * /home/gcoqueiro/painel-scroll/scripts/sync-images.sh
```

A pasta `images/` está no `.gitignore`: as imagens vivem só no RPi e nunca vão para o
GitHub. A ordem de exibição é alfabética pelo nome do arquivo — o dono do conteúdo
controla a sequência com prefixo (`01_`, `02_`, ...).

**6. Reiniciar**

```bash
sudo reboot
```

Se houver um `~/kiosk.sh` antigo, ele pode ser removido depois que o painel subir pela
nova cadeia — o `kiosk.desktop` deste repositório já aponta para `~/painel-scroll/scripts/kiosk.sh`.

## Diagnóstico

```bash
tail -f ~/kiosk.log                  # o que o kiosk.sh fez no boot e nos relançamentos
tail -f ~/sync-images.log            # última sincronização do Drive
pgrep -af painel-scroll-kiosk        # o Chromium está vivo?
curl -sI http://localhost:8080/      # o servidor local está de pé?
curl -s http://localhost:8080/images/manifest.json   # o que o painel vai exibir
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
| Slideshow não aparece | manifest vazio ou sync falhando | `tail ~/sync-images.log`, depois `rclone lsd gdrive:` |
| Imagem some da TV mas está no Drive | extensão fora da lista | só `.jpg`, `.jpeg`, `.png` e `.webp` são sincronizados |
| Sync para de apagar imagens | trava do `--max-delete` disparou | mais de 20 remoções de uma vez; conferir a pasta e rodar o script à mão |

## Desenvolvimento

Sem build step, sem dependências. Para testar na máquina local:

```bash
python3 -m http.server 8080 --directory .
```

Abra <http://localhost:8080/>. Em um navegador normal a página roda no modo `outer`
(fallback), que é exatamente o comportamento que a TV terá se a flag falhar — é o
cenário que mais importa validar antes de subir.
