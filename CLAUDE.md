# painel-scroll — Painel de TV com auto-scroll e slideshow

> Este arquivo é a fonte de verdade sobre o projeto. Leia-o inteiro antes de qualquer mudança.
> Quando uma decisão for tomada ou uma fase concluída, atualize as seções correspondentes
> (especialmente "Decisões em aberto" e "Histórico de decisões").

## 1. O que é este projeto

Painel exibido 24/7 em uma TV de fábrica, rodando em um Raspberry Pi 4 com Chromium em modo
kiosk. O painel espelha um dashboard público de eficiência energética (plataforma ISSO Digital,
"whitebox") que **outra pessoa** mantém, adiciona um scroll automático contínuo (o dashboard
original não tem) e, futuramente, intercala um slideshow de imagens vindas de uma pasta
compartilhada.

- Repositório: https://github.com/g-coqueiro/painel-scroll
- Deploy atual: https://g-coqueiro.github.io/painel-scroll/
- Dashboard espelhado: https://whitebox.isso.digital/UwiGFDAXcl5v/

## 2. Pessoas e responsabilidades

| Papel | Quem | O que faz |
|---|---|---|
| Dono do código | g-coqueiro (usuário deste repo) | Desenvolve o painel, mantém o RPi |
| Dono do conteúdo | Responsável pela eficiência energética da fábrica | Adiciona/remove gráficos no whitebox; futuramente coloca imagens na pasta compartilhada |

**Princípio de produto:** o dono do conteúdo deve continuar controlando o que aparece sem depender
do dono do código. Qualquer proposta que quebre isso precisa de justificativa forte.

## 3. Restrições técnicas (não negociáveis)

1. **Same-origin policy.** O `index.html` (github.io) NÃO consegue ler nada de dentro do iframe
   do whitebox (outro domínio): `scrollHeight`, DOM, observers — nada. Este é o motivo raiz do
   problema da altura manual. Nenhuma solução "só JS na página" resolve isso.
2. **Hardware/SO:** Raspberry Pi 4 (hostname `PainelScroll`), Raspberry Pi OS 64 bits (Debian 13
   trixie), Chromium 149.0.7827.114, sessão Wayland (labwc). TV 1920×1080 @ 60 Hz, paisagem.
   Evitar animações pesadas (transform em elementos gigantes, muitos repaints).
3. **Sem build step.** Vanilla HTML/CSS/JS. Sem framework, sem bundler, sem npm no front.
   O painel precisa funcionar abrindo o arquivo em um Chromium simples.
4. **Sem segredos no repo.** O repositório é público. Nenhuma API key, token ou URL privada.
5. **Não derrubar a TV.** Mudanças devem ser testáveis localmente antes de ir para o RPi.
   Manter um fallback: se algo falhar (manifest não carrega, iframe não responde), o painel
   continua mostrando o dashboard com scroll.

## 4. Estado atual (setembro/2026)

Fase 1 implementada no repositório (ainda **não instalada no RPi** — ver §6).

- `index.html` com um único objeto `CONFIG` e dois modos, escolhidos a cada carga do iframe:
  - `inner` (Chromium do kiosk, com `--disable-web-security`): iframe em `100vh`, scroll via
    `contentWindow.scrollTo`, altura lida do documento a cada quadro, reload ao fim do ciclo.
  - `outer` (qualquer navegador normal, inclusive GitHub Pages): comportamento antigo —
    altura fixa `CONFIG.fallbackHeightPx` e `translateY`. É o fallback do §3.5.
- `scripts/kiosk.sh` e `scripts/kiosk.desktop` versionados.
- `README.md` com instalação no RPi e diagnóstico.

**Estado anterior, para referência** (o que a Fase 1 resolveu): um `index.html` de ~140 linhas
com `height` fixo no CSS e duplicado numa constante JS (7692px, medido à mão no console do
whitebox), `translateY` no iframe inteiro e refresh do iframe a cada 30 min por relógio real.
O problema raiz era a altura manual: quando o colega adicionava gráficos, o final ficava
cortado até alguém medir de novo e fazer commit.

**Ainda em aberto:** `translateY` em um iframe de ~7700px é caro para o RPi 4 — some no modo
`inner` (que usa scroll nativo), mas continua valendo no fallback.

### 4.1 Como o RPi sobe o painel hoje (não quebrar isto)

```
Boot → autologin no desktop (raspi-config: Desktop Autologin, usuário gcoqueiro, Wayland/labwc)
  → ~/.config/autostart/kiosk.desktop  (Exec=/home/gcoqueiro/kiosk.sh)
    → kiosk.sh (loop, roda dentro da sessão gráfica; herda WAYLAND_DISPLAY e XDG_RUNTIME_DIR):
        1. espera rede (until ping)
        2. edita Preferences do perfil para suprimir aviso de "encerramento incorreto"
        3. resolve binário: command -v chromium-browser || command -v chromium
           (neste sistema → /usr/lib/chromium/chromium)
        4. while true; a cada 20 s: pgrep -f "painel-scroll" → se não achar,
           apaga Singleton* e relança o Chromium com &
Cron 04:00 → pkill -f chromium → o loop reabre o navegador limpo.
```

- Flags atuais nossas: `--kiosk`, `--password-store=basic`, `--noerrdialogs`, e outras.
- O Raspberry Pi OS injeta flags extras via `/etc/chromium.d/` (`--enable-gpu-rasterization`,
  `--use-angle=gles`, `--no-default-browser-check`...). **Não mexer nelas.**
- Ao rodar comandos por SSH para testar, é preciso exportar `WAYLAND_DISPLAY=wayland-0` e
  `XDG_RUNTIME_DIR` manualmente, porque fora da sessão eles não existem.

**Armadilhas ao alterar essa cadeia:**
- O `pgrep -f "painel-scroll"` só funciona porque a URL do GitHub Pages contém essa string.
  Ao migrar para localhost o padrão **precisa ser exclusivo da URL**: com o repo em
  `~/painel-scroll`, tanto o `http.server --directory ~/painel-scroll` quanto o próprio
  `~/painel-scroll/scripts/kiosk.sh` passam a conter "painel-scroll" na linha de comando.
  O `pgrep` acharia match sempre e **nunca relançaria o Chromium** depois de uma queda —
  falha silenciosa, TV preta até alguém perceber. Por isso a tag é `painel-scroll-kiosk`.
- Se for usado `--user-data-dir` novo, o conserto do `Preferences` (passo 2) tem que apontar
  para esse diretório.
- `kiosk.sh` roda antes do Chromium e dentro da sessão: é o lugar certo para `git pull` e para
  subir o servidor estático local. Não criar serviço systemd separado sem necessidade.

## 5. Arquitetura alvo

### 5.1 Onde roda cada coisa

```
GitHub (repo)  = fonte do código. Continua público.
RPi 4          = runtime. Repo clonado em /home/gcoqueiro/painel-scroll. O kiosk.sh, antes do
                 loop, faz `git pull` (com timeout, sem bloquear se falhar) e sobe
                 `python3 -m http.server 8080 --directory ~/painel-scroll &` se ainda não
                 estiver rodando. O Chromium abre http://localhost:8080/?painel-scroll-kiosk
                 (a tag `painel-scroll-kiosk` é exclusiva da URL; ver armadilha em §4.1).
GitHub Pages   = pode continuar existindo como preview, mas a TV NÃO deve depender dele.
```

Motivo: servir localmente permite (a) ler arquivos gerados no próprio RPi (manifest de imagens)
sem CORS/mixed-content e (b) funcionar mesmo sem internet para o GitHub.

### 5.2 Altura automática — Opção A (escolhida para a Fase 1)

Lançar o Chromium com a same-origin policy desativada. O RPi é um kiosk dedicado que abre um
único site controlado por nós, então o trade-off de segurança é aceitável.

```
$CHROMIUM --kiosk --noerrdialogs --password-store=basic \
  --disable-web-security --user-data-dir=/home/gcoqueiro/kiosk-profile \
  "http://localhost:8080/?painel-scroll-kiosk"
```

(`$CHROMIUM` é o binário já resolvido pelo kiosk.sh; as flags de `/etc/chromium.d/` entram
sozinhas. Manter as demais flags que já existem hoje no script.)

Notas sobre o flag no Chromium 149:
- `--disable-web-security` só tem efeito com `--user-data-dir` diferente do padrão. Usar um
  diretório persistente (não `/tmp`) para o conserto do `Preferences` valer entre reboots.
- Chromium mostra uma infobar de "flag não suportada"; em `--kiosk` ela normalmente não aparece.
  Validar na TV. Se aparecer, tentar `--test-type` (suprime essa infobar específica).
- O `pkill -f chromium` do cron das 4h continua funcionando sem alteração.

Com isso `frame.contentDocument` e `frame.contentWindow` ficam acessíveis. Consequências para o
código:

- Iframe passa a ter `height: 100vh`. Nada mais de altura fixa.
- O scroll é feito no documento interno: `frame.contentWindow.scrollTo(0, y)`.
- O limite é lido a cada frame/ciclo: `frame.contentDocument.documentElement.scrollHeight - frame.contentWindow.innerHeight`.
- Ao fim de cada ciclo completo (desce + sobe), recarregar o iframe (`frame.contentWindow.location.reload()`)
  para capturar gráficos novos. Esperar `load` antes de reiniciar o scroll.
- Opcional: injetar CSS no documento interno (esconder cabeçalho, ajustar zoom para TV).

**Plano B** caso o flag não funcione ou seja removido em versões futuras do Chromium: extensão
Chromium local (Manifest V3) com content script injetado direto em `whitebox.isso.digital`, sem
iframe, carregada com `--load-extension=`. Mesma lógica, sem o iframe no meio.

**Descartado:** sidecar com Playwright medindo a altura e gravando JSON (pesado para o RPi, resolve
o sintoma e não a causa).

### 5.3 Slideshow de imagens — Fase 2

Fonte das imagens: **pasta compartilhada no Google Drive** (decidido). Sobem imagens tanto o
dono do conteúdo quanto o dono do código.

```
[Google Drive: pasta compartilhada]
        │  scripts/sync-images.sh via cron a cada 5 min (usuário gcoqueiro):
        │    rclone sync gdrive:<pasta> ~/painel-scroll/images --include "*.{jpg,jpeg,png,webp}"
        │    gera images/manifest.json (lista ordenada de nomes + mtime)
        ▼
/home/gcoqueiro/painel-scroll/images/*.jpg|png|webp   (pasta no .gitignore)
        │
        ▼
index.html faz fetch('/images/manifest.json') e exibe cada imagem N segundos
```

Notas de setup do rclone:
- O remote do Drive precisa de OAuth uma única vez. O RPi é headless: rodar `rclone authorize
  "drive"` em um PC com navegador e colar o token no `rclone config` do RPi.
- Usar a conta de quem tem acesso à pasta compartilhada; para pasta de outra pessoa, configurar
  o remote com `shared_with_me = true` ou apontar pelo ID da pasta (`root_folder_id`).
- Token do rclone fica em `~/.config/rclone/rclone.conf`, fora do repo.
- `manifest.json` é regenerado a cada sync; a página relê o manifest no início de cada slideshow,
  então imagem nova aparece em ≤ 5 min + 1 ciclo de scroll.

Comportamento do painel (loop):

```
1. Scroll do dashboard: desce → sobe (SCROLL_DURATION_MS por sentido)
2. Slideshow: cada imagem do manifest por IMAGE_DURATION_MS, tela cheia,
   object-fit: contain, fundo #EDF1F6 (mesmo do dashboard). Fade simples.
3. Reload do iframe do dashboard (pega gráficos novos)
4. Volta ao passo 1
```

Regras:
- Manifest vazio ou inacessível → pula o slideshow silenciosamente, não quebra o loop.
- Ordem: alfabética pelo nome do arquivo (o colega controla a ordem com prefixo `01_`, `02_`...).
- Parâmetros (durações, caminho do manifest, URL do dashboard) centralizados em um único objeto
  `CONFIG` no topo do JS ou em `config.json` — nunca espalhados.

Descartado: pasta `images/` no repo listada pela API do GitHub (exigiria conta GitHub do dono do
conteúdo e tem atraso de deploy).

### 5.4 Dashboard próprio — Fase 3 (não iniciar)

Ideia registrada, **explicitamente adiada**. Só faz sentido se pelo menos um destes for verdade:

- A ISSO Digital expõe uma API de dados (aí: painel próprio lê a API, o dono do conteúdo
  escolhe o que exibir via `config.json` simples, ele mantém o controle).
- Precisa cruzar energia com outras fontes (produção, metas, custos).
- O layout do whitebox é inadequado para TV e injeção de CSS (§5.2) não resolve.

**Não fazer:** raspar os componentes do DOM do whitebox para remontar em outra tela. Quebra a cada
atualização da plataforma, e o dono do código vira gargalo sem o dono do conteúdo ganhar nada.

## 6. Roadmap

| Fase | Entregável | Critério de pronto |
|---|---|---|
| 1 | Altura automática + reload periódico + hospedagem local no RPi | Colega adiciona gráfico → em até 1 ciclo a TV mostra tudo, sem commit |
| 2 | Slideshow com imagens da pasta compartilhada | Colega solta imagem na pasta → em ≤10 min aparece na TV |
| 3 | (Adiada) Dashboard próprio | Só se um critério de §5.4 for atendido |

Entregas da Fase 1, em ordem:
1. [x] Refatorar `index.html`: `CONFIG` único, iframe 100vh, scroll via `contentWindow`, leitura
   de `scrollHeight` em tempo real, reload ao fim do ciclo, tratamento de erro.
2. [x] Versionar `scripts/kiosk.sh` no repo (hoje vive só em `/home/gcoqueiro/kiosk.sh`), com:
   `git pull` com timeout, subir `http.server` se não estiver rodando, novas flags de §5.2,
   conserto do `Preferences` apontando para o novo `--user-data-dir`, pgrep ajustado.
   O `kiosk.desktop` passa a chamar `~/painel-scroll/scripts/kiosk.sh`.
3. [x] `README.md` com instalação no RPi passo a passo (clone, autostart, cron das 4h).
4. [ ] **Validar no RPi** (único passo que fecha o critério de pronto): instalar pelo README,
   confirmar que a página entra no modo `inner` e que não aparece infobar de flag.

Entregas da Fase 2:
1. `scripts/sync-images.sh` (rclone sync + geração do manifest) e linha de cron.
2. Slideshow no `index.html` conforme §5.3, com fallback silencioso.
3. Seção do README sobre configurar o rclone e a pasta do Drive.

## 7. Decisões em aberto

Perguntar ao usuário antes de assumir:

- [ ] A página do whitebox atualiza sozinha (websocket/polling) ou precisa de reload para
      mostrar gráficos novos? Enquanto não souber, assumir que precisa e recarregar o iframe
      ao fim de cada ciclo.
- [ ] Durações: quanto tempo por sentido de scroll (hoje 250 s) e quanto por imagem?
      Assumir 10 s por imagem até definir. **Nota:** com altura automática, o dashboard
      crescer significa scroll mais rápido (a duração é fixa). Se ficar ilegível, trocar
      `scrollDurationMs` por velocidade constante em px/s.
- [x] Conteúdo exato do `kiosk.sh` atual e do `kiosk.desktop` — recebidos em 2026-09-14 e
      incorporados em `scripts/`. Todas as flags originais foram preservadas.

## 8. Convenções para o Claude Code

- Idioma: comentários, commits e documentação em **português (pt-BR)**. Código (nomes de
  variáveis/funções) em inglês.
- Um `index.html` autocontido enquanto couber em ~300 linhas; se crescer, separar em
  `app.js` e `style.css`, sem bundler.
- Todo parâmetro ajustável vive em `CONFIG`. Nunca hardcode duração, URL ou caminho no meio da lógica.
- Não introduzir dependências externas (CDN, libs). Vanilla.
- Antes de propor mudança de arquitetura, conferir §3 (restrições) e §5.4 (o que não fazer).
- Ao concluir uma entrega do roadmap, marcar em §6 e registrar em §9.
- Commits pequenos e descritivos: `feat:`, `fix:`, `docs:`, `chore:`.

## 9. Histórico de decisões

| Data | Decisão | Motivo |
|---|---|---|
| 2026-09-14 | Criado este CLAUDE.md | Formalizar contexto antes de iniciar Fase 1 |
| 2026-09-14 | Altura automática via `--disable-web-security` (Opção A); extensão como plano B | Mudança mínima no código atual; kiosk dedicado torna o trade-off aceitável |
| 2026-09-14 | RPi passa a servir a página localmente | Necessário para manifest de imagens sem CORS e resiliência offline |
| 2026-09-14 | Dashboard próprio adiado (Fase 3) | Manter controle de conteúdo com o responsável pela eficiência energética |
| 2026-09-14 | Descartado scraping do DOM do whitebox | Frágil e não dá autonomia a ninguém |
| 2026-09-14 | Imagens via Google Drive + rclone no RPi | Ambos os donos usam Drive; sem chave exposta; alternativa via repo GitHub descartada |
| 2026-09-14 | Slideshow entre ciclos de scroll | Escolha do usuário |
| 2026-09-14 | Documentada a cadeia de boot atual (§4.1) | Evitar quebrar autostart/pgrep/Preferences ao migrar para localhost |
| 2026-09-14 | URL do kiosk passa a ser `http://localhost:8080/?painel-scroll-kiosk` | Mantém o pgrep atual funcionando sem alterar o loop |
| 2026-09-14 | Tag do pgrep vira `painel-scroll-kiosk` (não `painel-scroll`) | `http.server` e o próprio `kiosk.sh` contêm "painel-scroll" na linha de comando; o match seria sempre verdadeiro e o Chromium nunca seria relançado |
| 2026-09-14 | `index.html` com dois modos (`inner`/`outer`) detectados a cada carga | Fallback do §3.5 sem código duplicado; a página continua correta no GitHub Pages e se a flag sumir numa atualização do Chromium |
| 2026-09-14 | Reload do iframe por ciclo substitui o timer de 30 min | Alinha a recarga ao único instante que não corta a animação; o watchdog cobre o caso de ciclo travado |
| 2026-09-14 | `http.server` com `--bind 127.0.0.1` | O painel não precisa ser acessível pela rede da fábrica |
| 2026-09-14 | CLAUDE.md passa a viver no repositório | Era mantido solto em `Downloads`, fora do versionamento |
