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
2. Slides de CONFIG.slides
   ├─ lista vazia ou nenhum carrega → recarrega o dashboard e volta ao passo 1
   └─ com slides → cada um em tela cheia (o dashboard recarrega escondido atrás deles)
3. Volta ao passo 1, já com o dashboard atualizado
```

Os arquivos: `index.html` (esqueleto), `style.css`, `app.js` (toda a lógica, com o `CONFIG`
no topo), `scripts/kiosk.sh` (boot), `scripts/serve.py` (servidor local) e
e os slides em `slides/`.

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

**5. Slides**

Entre um ciclo de scroll e outro o painel exibe páginas HTML da pasta `slides/`, na ordem
e pelo tempo definidos em `CONFIG.slides`, no topo do `app.js`:

```js
slides: [
    { src: 'slides/kaizen-spda-g09-g10.html', durationMs: 45000 },
    { src: 'slides/kaizen-portoes-g09-g11.html', durationMs: 45000 }
],
```

> **A pasta `slides/` está no `.gitignore` e não vai para o GitHub.** Os slides trazem nomes
> de funcionários e fotos internas, e o repositório é público — o histórico do git é
> permanente, então apagar depois não resolveria. Eles vivem só no RPi.

Para acrescentar um slide:

1. copie o arquivo para o RPi:

```bash
scp meu-slide.html gcoqueiro@10.8.3.161:~/painel-scroll/slides/
```

2. acrescente a linha em `CONFIG.slides` (no `app.js`, que é versionado), commite e no RPi:

```bash
git -C ~/painel-scroll pull && pkill -f chromium
```

Como a pasta é ignorada pelo git, o `git pull` não mexe nos slides já copiados.

Regras dos slides:

- **Desenhe em 1920×1080 com layout fixo** (`body { width: 1920px; height: 1080px }`).
  O painel mantém o iframe nessa resolução e o encolhe por `transform` para caber na
  janela — necessário porque o kiosk roda com zoom (§4.2 do CLAUDE.md), e sem isso o
  slide apareceria cortado. Outra resolução funciona, desde que `slideBaseWidth` e
  `slideBaseHeight` sejam ajustados junto.
- **Autocontido**: imagens e fontes embutidas como `data:` URI, sem requisição externa.
  Assim o slide funciona com a internet fora.
- Slide que não existe ou não carrega em `slideTimeoutMs` é pulado em silêncio.
- Lista vazia = sem slides; o painel só rola o dashboard.

**6. Reiniciar**

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
pgrep -af serve.py                   # quem está servindo a página
curl -sI http://localhost:8080/slides/  # os slides estão sendo servidos?
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
| Slide não aparece | arquivo ausente ou caminho errado no `CONFIG` | `curl -sI http://localhost:8080/slides/<arquivo>` — tem que dar 200 |
| Slide aparece cortado | layout não é do tamanho de `slideBaseWidth`×`slideBaseHeight` | ajustar o HTML para 1920×1080, ou o `CONFIG` para a resolução usada |
| Slide sem imagens/fontes | recursos externos em vez de `data:` URI | embutir tudo no HTML |

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
