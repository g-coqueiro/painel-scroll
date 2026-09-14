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
      3. sobe scripts/serve.py na porta 8080, servindo o repositório
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
no topo), `scripts/kiosk.sh` (boot), `scripts/serve.py` (servidor local) e
`scripts/sync-images.sh` (imagens do Drive).

O iframe é **sempre** alto o bastante para o dashboard inteiro, e o scroll é **sempre**
`translateY`. O que muda entre os dois modos é só de onde vem o número da altura:

| Modo | Quando | Altura |
|---|---|---|
| `medido` | Chromium do kiosk, com as flags de permissão | lida do dashboard, reconferida a cada segundo |
| `fixo` | qualquer navegador normal, incluindo GitHub Pages | `CONFIG.fallbackHeightPx` |

No modo `medido` ninguém precisa medir altura nem fazer commit quando um gráfico novo é
adicionado — é o objetivo da Fase 1. O modo `fixo` é o fallback: garante que a TV não fica
preta se as flags deixarem de funcionar numa atualização do Chromium.

**Não encolher o iframe para `100vh` para rolar por dentro.** O whitebox se redesenha
conforme o tamanho do viewport e o painel fica desfigurado. A permissão serve para medir,
não para rolar.

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
chmod +x ~/painel-scroll/scripts/*.sh ~/painel-scroll/scripts/serve.py
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

> **As duas máquinas precisam da MESMA versão do rclone.** O token é emitido para uma
> identidade de aplicativo, e a versão do `apt` do Debian não bate com a oficial —
> resultado: `invalid_client: The provided client secret is invalid`.

No RPi, instale a versão oficial (a do `apt` é antiga demais):

```bash
cd /tmp && curl -O https://downloads.rclone.org/rclone-current-linux-arm64.zip && unzip -o rclone-current-linux-arm64.zip
```

```bash
sudo cp /tmp/rclone-*-linux-arm64/rclone /usr/local/bin/ && sudo chmod 755 /usr/local/bin/rclone && hash -r && rclone version | head -1
```

No PC (com navegador), instale a mesma versão — `winget install Rclone.Rclone` no Windows —
confirme com `rclone version` e gere o token:

```bash
rclone authorize "drive" --drive-scope=drive.readonly
```

Se aparecer o aviso de que o `client_id` compartilhado está sendo aposentado, responda **`y`**
(veja o prazo em CLAUDE.md §7). O navegador abre; autorize e copie o bloco
`{"access_token":...}` inteiro.

De volta ao RPi:

```bash
rclone config
```

- `n` (novo remote), nome: **gdrive**
- tipo: **drive**
- "Continue using the shared client_id anyway?" → **`y`** (o padrão é não)
- `scope`: **2** (`drive.readonly`) — o painel só lê a pasta, nunca escreve nela
- configuração avançada: **y**, e em `root_folder_id` cole o ID da pasta — é o trecho da
  URL do Drive depois de `/folders/`. O resto: Enter até o fim
- **"Use web browser to automatically authenticate?"** → **`n`**
- Cole o token gerado no PC
- "Configure this as a Shared Drive (Team Drive)?" → `n`

Teste e agende:

```bash
rclone ls gdrive:                      # deve listar as imagens sem pedir login
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
pgrep -af serve.py                   # quem está servindo a página
curl -s http://localhost:8080/images/manifest.json   # o que o painel vai exibir
```

Para rodar algum comando gráfico por SSH (fora da sessão do desktop), exporte antes:

```bash
export WAYLAND_DISPLAY=wayland-0
export XDG_RUNTIME_DIR=/run/user/$(id -u)
```

Para saber em que estado a página está **sem olhar a TV**, o painel registra os próprios
números no log do servidor a cada carga:

```bash
grep __diag ~/http.log | tail -2
```

```
/__diag/assentado__janela-1280x720__zoom-1.5__modo-medido__medida-9399__altura-9399__dashboard-1280
```

- `janela` × `zoom` tem que dar 1920×1080. Se não der, a janela não está cobrindo a TV.
- `modo-medido` = está lendo o dashboard. `modo-fixo` = as flags de permissão não pegaram.
- `medida` igual a `altura` = o número em uso veio de leitura real. Diferentes = caiu no fallback.
- Sai duas vezes por carga: `carregou` e, 45 s depois, `assentado` (gráficos já desenhados).

### Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| **Tarjas laterais, dashboard estreito** | zoom do Chromium voltou a 100% | o whitebox precisa de ~1280px CSS de largura: pôr o zoom em 150% (`Ctrl +`). O zoom mora no perfil, então some se `~/kiosk-profile` for apagado |
| Fim do dashboard cortado | caiu no modo `fixo` | `grep __diag ~/http.log`; conferir `--disable-web-security`, `--disable-site-isolation-trials` e `--user-data-dir` em `pgrep -af chromium` |
| Mudança não aparece depois do `git pull` | alteração foi no `kiosk.sh` | `pull` só aplica `app.js`/`index.html`/`style.css` (+ `pkill -f chromium`). `kiosk.sh` exige `sudo reboot` |
| Tela em branco | servidor local não subiu | `tail ~/kiosk.log`, checar `pgrep -af serve.py` |
| Chromium não relança sozinho | padrão do `pgrep` batendo em outro processo | o padrão precisa ser exclusivo da URL (`painel-scroll-kiosk`) |
| Gráfico novo não aparece | reload ainda não ocorreu | acontece ao fim de cada ciclo de scroll; `CONFIG.reloadOnCycleEnd` |
| Slideshow não aparece | manifest vazio ou sync falhando | `tail ~/sync-images.log`, depois `rclone ls gdrive:` |
| Imagem some da TV mas está no Drive | extensão fora da lista | só `.jpg`, `.jpeg`, `.png` e `.webp` são sincronizados |
| Sync para de apagar imagens | trava do `--max-delete` disparou | mais de 20 remoções de uma vez; conferir a pasta e rodar o script à mão |
| `invalid_client` no rclone | token gerado por outra instalação do rclone, ou `client_id` compartilhado aposentado | as duas máquinas precisam da mesma versão do rclone; se persistir, criar `client_id` próprio |
| Slideshow congelou e o dashboard segue normal | sync parou (token/`client_id`) | `tail ~/sync-images.log` — é a falha mais silenciosa do projeto |

## Desenvolvimento

Sem build step, sem dependências. Para testar na máquina local:

```bash
python3 scripts/serve.py 8080 .
```

(É o mesmo servidor que roda no RPi. Ele desliga o cache: sem isso o navegador
continua rodando o `app.js` antigo depois de uma alteração, o que já custou uma
rodada inteira de diagnóstico no projeto.)

Abra <http://localhost:8080/>. Em um navegador normal a página roda no modo `outer`
(fallback), que é exatamente o comportamento que a TV terá se a flag falhar — é o
cenário que mais importa validar antes de subir.
