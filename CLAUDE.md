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

Fases 1 e 2 no ar no RPi desde 2026-09-14.

- `index.html` (esqueleto), `style.css` e `app.js` — passou de 300 linhas com o slideshow e
  foi separado conforme §8. Todo o `CONFIG` vive no topo do `app.js`.
- O iframe é **sempre** alto o bastante para o conteúdo inteiro e o scroll é **sempre**
  `translateY`. O que muda entre os dois modos é só de onde vem o número da altura:
  - `medido`: a permissão do kiosk deixa ler `scrollHeight` do dashboard. Altura
    reconferida 1×/s durante o scroll; escrita no elemento só quando muda.
  - `fixo`: sem permissão (navegador comum, GitHub Pages), usa `CONFIG.fallbackHeightPx`.
    É o fallback do §3.5.
- Slides HTML entre os ciclos (§5.3), listados em `CONFIG.slides`; slide ausente ou que
  não carrega é pulado em silêncio.
- `scripts/kiosk.sh` (boot) e `scripts/serve.py` (servidor sem cache) versionados.
- `README.md` com instalação no RPi, regras dos slides e diagnóstico.

**Estado anterior, para referência** (o que a Fase 1 resolveu): um `index.html` de ~140 linhas
com `height` fixo no CSS e duplicado numa constante JS (7692px, medido à mão no console do
whitebox), `translateY` no iframe inteiro e refresh do iframe a cada 30 min por relógio real.
O problema raiz era a altura manual: quando o colega adicionava gráficos, o final ficava
cortado até alguém medir de novo e fazer commit.

**Ainda em aberto:**
- `translateY` em um iframe de ~9400px é caro para o RPi 4. Vale nos dois modos, já que
  encolher o iframe não é opção (§4.2). Não deu problema visível até agora.
- Fase 1 **confirmada com dado da TV** em 2026-09-14:
  `modo-medido__medida-9399__altura-9399__dashboard-1280`. `medida` igual a `altura`
  significa leitura real, não fallback.

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

### 4.2 Zoom: o whitebox depende da LARGURA EM PIXELS CSS da janela

Descoberto na marra em 2026-09-14, depois de duas correções erradas minhas.

- A 1920 px CSS de largura, o dashboard se desenha com margens laterais enormes
  (tarjas nos dois lados, ~50% da tela).
- A 1280 px CSS (que é o que o zoom de 150% produz numa TV 1920×1080) ele preenche.
- **O zoom de página fica salvo no perfil do Chromium.** Ao introduzir
  `--user-data-dir` com um perfil novo, o zoom se perdeu e as tarjas apareceram —
  parecendo, enganosamente, um efeito das outras mudanças feitas no mesmo dia.
- O zoom atual (150%) foi reaplicado à mão. **Ele mora só no perfil**: se
  `~/kiosk-profile` for apagado ou recriado, as tarjas voltam.
  Para tornar reproduzível, a alternativa é `--force-device-scale-factor=1.5`
  no kiosk.sh — mas então o zoom manual precisa voltar para 100% (Ctrl+0),
  senão os dois se multiplicam.

Consequência para a altura: `fallbackHeightPx` foi medido a 1920 px CSS (9399px).
Com o zoom em 150% a largura efetiva é 1280 e **a altura real é outra**. Enquanto
o modo `medido` não funcionar, esse número precisa ser remedido na largura efetiva.

**Armadilhas ao alterar essa cadeia:**
- O servidor (`scripts/serve.py`) manda `Cache-Control: no-store` e ignora revalidação
  condicional. Não voltar para o `http.server` padrão: o Chromium cacheia o `app.js` e a
  TV passa a rodar código que não é mais o do repositório.
- `git pull` NÃO aplica mudanças no `kiosk.sh`: o loop já está rodando em memória
  com a versão anterior e só troca no próximo boot. Mudança em `app.js`/`index.html`/
  `style.css` basta `pull` + `pkill -f chromium`; mudança no `kiosk.sh` exige reboot.
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
- **Sozinho ele não basta.** O isolamento de sites coloca o iframe de outro domínio em outro
  processo, e aí o acesso ao DOM continua bloqueado — confirmado na TV em 2026-09-14
  (`modo-fixo` / `dashboard-ilegivel` com a flag ativa na linha de comando). É preciso
  `--disable-site-isolation-trials` e `--disable-features=IsolateOrigins,site-per-process`.
- Cuidado: passar `--disable-features` duas vezes faz a última vencer e a primeira ser
  ignorada em silêncio. Tudo tem que ir numa lista só, junto com `TranslateUI`.
- **Encolher o iframe para 100vh e rolar por dentro não funciona** com este dashboard: ele
  se redesenha conforme a largura/altura do viewport (ver §4.2). O iframe tem que continuar
  alto o bastante para o conteúdo inteiro, com scroll por `translateY`. A permissão serve
  só para MEDIR a altura, não para rolar.
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

### 5.3 Slides — Fase 2 (revista em 2026-09-14)

**Decisão revista:** a Fase 2 foi entregue com imagens vindas do Google Drive via rclone e,
no mesmo dia, substituída por **páginas HTML versionadas no repositório**. O usuário pediu
explicitamente para não deixar aberto "o que vai de imagem no sistema".

```
slides/*.html  →  CONFIG.slides (app.js)  →  exibidos entre os ciclos de scroll
```

- Cada slide é um HTML autocontido de 1920×1080 com layout fixo. O painel mantém o iframe
  nessa resolução e o encolhe por `transform: scale()` para caber na janela — necessário
  por causa do zoom do kiosk (§4.2).
- Duração por slide em `CONFIG.slides[].durationMs` (hoje 45 s cada).
- Slide ausente ou que não carrega é pulado em silêncio; lista vazia = só dashboard.
- Publicar um slide novo = commit + `git pull` no RPi.

**Consequência para o §2:** isto inverte o princípio de produto. O dono do conteúdo não
adiciona mais nada sozinho — passa pelo dono do código. Foi uma escolha consciente do
usuário, trocando autonomia por controle editorial. Se um dia o volume de slides crescer
a ponto de virar gargalo, reabrir a discussão (o código do sync por Drive está no
histórico do git, em `scripts/sync-images.sh`, removido no commit desta mudança).

**Descartado:** pasta `images/` sincronizada do Drive por rclone (implementada e
funcionando, mas abandonada por decisão editorial); pasta `images/` no repo listada pela
API do GitHub (exigiria conta GitHub do dono do conteúdo).

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
4. [x] **Validado no RPi** em 2026-09-14: `modo-medido`, sem infobar de flag.

Entregas da Fase 2:
1. [x] `scripts/sync-images.sh` (rclone sync + geração do manifest) e linha de cron.
2. [x] Slideshow conforme §5.3, com fallback silencioso.
3. [x] Seção do README sobre configurar o rclone e a pasta do Drive.
4. [x] rclone autorizado em 2026-09-14 (`rclone ls gdrive:` respondendo).
5. [ ] Cron do sync e primeira exibição na TV.

## 7. Decisões em aberto

Perguntar ao usuário antes de assumir:

- [x] ~~Prazo do `client_id` compartilhado do rclone~~ — deixou de importar em 2026-09-14,
      quando o rclone saiu do projeto (§5.3). Se o sync por Drive voltar um dia, o prazo
      volta junto: o `client_id` compartilhado é aposentado durante 2026, e a falha é
      silenciosa (o painel continua rolando, só as imagens congelam).

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
| 2026-09-14 | **Revertido:** rclone/Drive sai, entram slides HTML versionados (§5.3) | Escolha editorial do usuário: controlar o que entra em vez de deixar a pasta aberta. Custo assumido: inverte o princípio do §2 |
| 2026-09-14 | Slides em iframe de 1920×1080 encolhido por `transform: scale()` | Layout fixo precisa da resolução nativa para se desenhar certo; a escala resolve o zoom do kiosk sem tocar no HTML do slide |
| 2026-09-14 | Slideshow entre ciclos de scroll | Escolha do usuário |
| 2026-09-14 | Documentada a cadeia de boot atual (§4.1) | Evitar quebrar autostart/pgrep/Preferences ao migrar para localhost |
| 2026-09-14 | URL do kiosk passa a ser `http://localhost:8080/?painel-scroll-kiosk` | Mantém o pgrep atual funcionando sem alterar o loop |
| 2026-09-14 | Tag do pgrep vira `painel-scroll-kiosk` (não `painel-scroll`) | `http.server` e o próprio `kiosk.sh` contêm "painel-scroll" na linha de comando; o match seria sempre verdadeiro e o Chromium nunca seria relançado |
| 2026-09-14 | `index.html` com dois modos (`inner`/`outer`) detectados a cada carga | Fallback do §3.5 sem código duplicado; a página continua correta no GitHub Pages e se a flag sumir numa atualização do Chromium |
| 2026-09-14 | Reload do iframe por ciclo substitui o timer de 30 min | Alinha a recarga ao único instante que não corta a animação; o watchdog cobre o caso de ciclo travado |
| 2026-09-14 | `http.server` com `--bind 127.0.0.1` | O painel não precisa ser acessível pela rede da fábrica |
| 2026-09-14 | CLAUDE.md passa a viver no repositório | Era mantido solto em `Downloads`, fora do versionamento |
| 2026-09-14 | Código separado em `index.html` + `style.css` + `app.js` | Passou de ~300 linhas com o slideshow; regra do §8 |
| 2026-09-14 | ID da pasta do Drive fica só no `rclone.conf` do RPi, nunca no repo | O repo é público e o ID é um link de acesso (§3.4). O script referencia apenas o remote `gdrive:` |
| 2026-09-14 | Reload do dashboard acontece **atrás** do overlay do slideshow, não antes | Ordem do §5.3 invertida de propósito: recarregar antes deixava o iframe piscando em branco à vista enquanto o manifest não respondia |
| 2026-09-14 | Manifest regenerado sempre a partir do disco, mesmo se o rclone falhar | Evita manifest apontando para arquivo que não existe |
| 2026-09-14 | `rclone sync` com `--max-delete 20` | Um erro de permissão que faça o remote responder vazio apagaria todas as imagens da TV de uma vez |
| 2026-09-14 | Escopo somente-leitura no rclone | O painel só lê a pasta; escopo total permitiria apagar o Drive do dono do conteúdo por engano |
| 2026-09-14 | Iframe volta a ser alto + `translateY`; permissão só para medir | Encolher para 100vh desfigurou o dashboard na TV (§4.2) |
| 2026-09-14 | Documentado que o layout do whitebox depende da largura em px CSS (§4.2) | Causa real das tarjas laterais; custou duas correções erradas antes de aparecer |
| 2026-09-14 | Painel registra diagnóstico em `~/http.log` via `/__diag/...` | Ler o selo na TV é ambíguo — a primeira leitura veio de outro navegador e quase gerou um terceiro palpite errado |
| 2026-09-14 | Isolamento de sites desligado junto com `--disable-web-security` | Só a segunda flag dá acesso real ao DOM do iframe; confirmado com dado da TV |
| 2026-09-14 | `scripts/serve.py` substitui `python3 -m http.server` | O servidor padrão deixava o Chromium cachear o `app.js`: depois de um `git pull` a TV seguia rodando código antigo, silenciosamente. Um deploy tem que ser um deploy |
